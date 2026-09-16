import { LivePosition, parseTradovateSocketFrame } from './tradovate-live.utils';
import { TradovateLiveAccountMetric } from './tradovate-live.models';

export interface LiveInstrument { valuePerPoint: number; currency: string; }
export interface LiveQuote { bid?: number; ask?: number; timestamp: number; bidAt?: number; askAt?: number; }
export const OPEN_PNL_STALE_MS = 15_000;
type Valuation = Pick<TradovateLiveAccountMetric, 'openPnl' | 'openPnlState' | 'openPositions'>;

/** Conservative mark: bid for longs, offer for shorts. No guessed FX or fees. */
export function valueOpenPositions(positions: readonly LivePosition[], instruments: ReadonlyMap<number, LiveInstrument | null>,
    quotes: ReadonlyMap<number, LiveQuote>, now: number): Valuation {
    let total = 0;
    for (const position of positions) {
        const instrument = position.contractId === null ? null : instruments.get(position.contractId);
        if (instrument === null || position.contractId === null || position.netPrice === null) {
            return { openPnl: null, openPnlState: 'unavailable', openPositions: positions.length };
        }
        if (!instrument) return { openPnl: null, openPnlState: 'waiting', openPositions: positions.length };
        if (instrument.currency !== 'USD' || !Number.isFinite(instrument.valuePerPoint) || instrument.valuePerPoint <= 0) {
            return { openPnl: null, openPnlState: 'unavailable', openPositions: positions.length };
        }
        const quote = quotes.get(position.contractId);
        const mark = position.netPos > 0 ? quote?.bid : quote?.ask;
        if (!quote || mark === undefined || !Number.isFinite(mark)) return { openPnl: null, openPnlState: 'waiting', openPositions: positions.length };
        const priceAt = (position.netPos > 0 ? quote.bidAt : quote.askAt) ?? quote.timestamp;
        if (now - priceAt > OPEN_PNL_STALE_MS || priceAt > now + 2_000 || priceAt < position.observedAt) {
            return { openPnl: null, openPnlState: 'stale', openPositions: positions.length };
        }
        total += (mark - position.netPrice) * position.netPos * instrument.valuePerPoint;
    }
    return { openPnl: Number.isFinite(total) ? Math.round(total * 100) / 100 : null,
        openPnlState: Number.isFinite(total) ? 'live' : 'unavailable', openPositions: positions.length };
}

/** Leader-owned, read-only quote stream. Exists only while open-P&L alerts are opted in. */
export class TradovateOpenPnlStream {
    private socket: WebSocket | null = null;
    private positions: LivePosition[] = [];
    private instruments = new Map<number, LiveInstrument | null>();
    private quotes = new Map<number, LiveQuote>();
    private subscribed = new Set<number>();
    private requests = new Map<number, { contractId: number; started: number }>();
    private failures = new Set<number>();
    private nextId = 2;
    private authorized = false;
    private stopped = false;
    private denied = false;
    private lastMessage = 0;
    private heartbeat: ReturnType<typeof setInterval> | undefined;
    private retry: ReturnType<typeof setTimeout> | undefined;
    private notification: ReturnType<typeof setTimeout> | undefined;
    private attempts = 0;

    constructor(private readonly token: string, private readonly instrument: (id: number) => Promise<LiveInstrument>,
        private readonly changed: () => void) {}

    updatePositions(positions: LivePosition[]): void {
        if (this.stopped) return;
        this.positions = positions;
        const ids = new Set(positions.map(p => p.contractId).filter((id): id is number => id !== null));
        for (const id of ids) if (!this.instruments.has(id)) {
            // A null placeholder prevents duplicate metadata requests while it is loading.
            this.instruments.set(id, null);
            void this.loadInstrument(id);
        }
        for (const id of this.subscribed) if (!ids.has(id)) {
            this.send('md/unsubscribeQuote', this.nextId++, { symbol: id });
            this.subscribed.delete(id); this.quotes.delete(id); this.failures.delete(id);
            for (const [requestId, request] of this.requests) if (request.contractId === id) this.requests.delete(requestId);
        }
        if (!ids.size) { this.close(); clearTimeout(this.retry); this.retry = undefined; }
        else if (!this.socket && !this.retry && !this.denied) this.connect();
        else this.subscribe();
        this.notify();
    }

    valuation(accountId: number): Valuation {
        const positions = this.positions.filter(position => position.accountId === accountId);
        if (!positions.length) return { openPnl: 0, openPnlState: 'live', openPositions: 0 };
        if (this.denied || positions.some(p => p.contractId !== null && this.failures.has(p.contractId))) {
            return { openPnl: null, openPnlState: 'unavailable', openPositions: positions.length };
        }
        if (!this.authorized) return { openPnl: null, openPnlState: 'waiting', openPositions: positions.length };
        return valueOpenPositions(positions, this.instruments, this.quotes, Date.now());
    }

    dispose(): void {
        this.stopped = true; clearTimeout(this.retry); clearTimeout(this.notification);
        this.close(); this.positions = []; this.instruments.clear(); this.quotes.clear();
    }

    private async loadInstrument(id: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([this.instrument(id), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Metadata timeout')), 10_000);
            })]);
            if (!this.stopped) this.instruments.set(id, result);
        } catch { if (!this.stopped) this.instruments.set(id, null); }
        finally { clearTimeout(timer); this.notify(); }
    }

    private connect(): void {
        if (this.stopped || this.denied || !this.positions.length) return;
        const socket = this.socket = new WebSocket('wss://md.tradovateapi.com/v1/websocket');
        this.lastMessage = Date.now();
        const startedAt = Date.now();
        socket.onmessage = event => {
            if (this.socket !== socket || this.stopped) return;
            this.lastMessage = Date.now();
            const frame = parseTradovateSocketFrame(event.data);
            if (frame.type === 'open') { this.send('authorize', 1, this.token); return; }
            if (frame.type === 'close') { socket.close(); return; }
            if (frame.type !== 'messages') return;
            for (const message of frame.messages) {
                if (message.e === 'shutdown') { socket.close(); continue; }
                if (message.i === 1) {
                    if (message.s === 200 && !(message.d as { errorText?: unknown } | null)?.errorText) { this.authorized = true; this.attempts = 0; this.subscribe(); }
                    else { this.denied = true; this.close(); }
                } else if (message.i !== undefined && this.requests.has(message.i)) {
                    const request = this.requests.get(message.i)!;
                    this.requests.delete(message.i);
                    const data = message.d as { errorText?: unknown; 'p-ticket'?: unknown } | undefined;
                    if (message.s !== 200 || data?.errorText || data?.['p-ticket']) this.failures.add(request.contractId);
                } else if (message.e === 'md') this.readQuotes(message.d);
            }
            this.notify();
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
            if (this.socket !== socket || this.stopped) return;
            this.close(); this.notify();
            if (!this.denied && this.positions.length) {
                this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)));
            }
        };
        this.heartbeat = setInterval(() => {
            if (this.stopped || this.socket !== socket) return;
            if (!this.authorized && Date.now() - startedAt > 10_000) {
                this.denied = true; this.close(); this.notify(); return;
            }
            if (Date.now() - this.lastMessage > 20_000) { socket.close(); return; }
            if (socket.readyState === WebSocket.OPEN) socket.send('[]');
            for (const [id, request] of this.requests) if (Date.now() - request.started > 10_000) {
                this.requests.delete(id); this.failures.add(request.contractId);
            }
            this.notify();
        }, 2_500);
    }

    private subscribe(): void {
        if (!this.authorized) return;
        for (const position of this.positions) {
            const id = position.contractId;
            if (id === null || this.subscribed.has(id)) continue;
            this.subscribed.add(id);
            const requestId = this.nextId++;
            this.requests.set(requestId, { contractId: id, started: Date.now() });
            this.send('md/subscribeQuote', requestId, { symbol: id });
        }
    }

    private readQuotes(payload: unknown): void {
        const data = payload as { quotes?: unknown } | null;
        if (!Array.isArray(data?.quotes)) return;
        for (const raw of data.quotes) {
            if (!raw || typeof raw !== 'object' || !this.subscribed.has(raw.contractId)) continue;
            const timestamp = Date.parse(raw.timestamp);
            if (!Number.isFinite(timestamp) || timestamp < (this.quotes.get(raw.contractId)?.timestamp ?? 0)) continue;
            // Quote entries are incremental; retain each side with its own freshness.
            const bid = raw.entries?.Bid?.price; const ask = raw.entries?.Offer?.price;
            if (typeof bid !== 'number' && typeof ask !== 'number') continue;
            const previous = this.quotes.get(raw.contractId);
            this.quotes.set(raw.contractId, { ...previous, timestamp,
                ...(typeof bid === 'number' ? { bid: Number.isFinite(bid) ? bid : undefined, bidAt: timestamp } : {}),
                ...(typeof ask === 'number' ? { ask: Number.isFinite(ask) ? ask : undefined, askAt: timestamp } : {}) });
        }
    }

    private send(endpoint: string, id: number, body: unknown): void {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(`${endpoint}\n${id}\n\n${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    private notify(): void {
        if (this.stopped || this.notification) return;
        this.notification = setTimeout(() => { this.notification = undefined; if (!this.stopped) this.changed(); }, 100);
    }

    private close(): void {
        clearInterval(this.heartbeat); this.heartbeat = undefined;
        if (this.socket) {
            this.socket.onmessage = null; this.socket.onclose = null; this.socket.onerror = null;
            this.socket.close(); this.socket = null;
        }
        this.authorized = false; this.subscribed.clear(); this.requests.clear(); this.quotes.clear();
    }
}
