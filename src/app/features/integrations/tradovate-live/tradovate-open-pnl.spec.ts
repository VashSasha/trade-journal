import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePosition } from './tradovate-live.utils';
import { LiveInstrument, LiveQuote, OPEN_PNL_STALE_MS, TradovateOpenPnlStream, valueOpenPositions } from './tradovate-open-pnl';

const position = (overrides: Partial<LivePosition> = {}): LivePosition => ({
    id: 1, accountId: 10, contractId: 20, netPos: 2, netPrice: 100,
    tradeDate: '2026-09-15', observedAt: 1000, ...overrides,
});
const instruments = new Map<number, LiveInstrument | null>([[20, { valuePerPoint: 5, currency: 'USD' }]]);
const quotes = new Map<number, LiveQuote>([[20, { bid: 110, ask: 111, timestamp: 2000 }]]);

describe('open P&L valuation', () => {
    it('marks longs at bid and shorts at ask with broker contract multipliers', () => {
        expect(valueOpenPositions([position()], instruments, quotes, 2000).openPnl).toBe(100);
        expect(valueOpenPositions([position({ netPos: -2 })], instruments, quotes, 2000).openPnl).toBe(-110);
        expect(valueOpenPositions([position(), position({ id: 2, accountId: 11 })], instruments, quotes, 2000).openPnl).toBe(200);
        expect(valueOpenPositions([], instruments, quotes, 2000).openPnl).toBe(0);
    });

    it('never substitutes zero for stale, missing, pre-position or unsupported valuations', () => {
        expect(valueOpenPositions([position()], instruments, quotes, 2001 + OPEN_PNL_STALE_MS).openPnl).toBeNull();
        expect(valueOpenPositions([position({ observedAt: 3000 })], instruments, quotes, 3000).openPnl).toBeNull();
        expect(valueOpenPositions([position()], instruments, new Map(), 2000).openPnl).toBeNull();
        expect(valueOpenPositions([position({ netPrice: null })], instruments, quotes, 2000).openPnl).toBeNull();
        expect(valueOpenPositions([position()], new Map([[20, { valuePerPoint: 5, currency: 'EUR' }]]), quotes, 2000).openPnl).toBeNull();
        const partial = new Map([[20, { bid: 110, ask: 111, timestamp: 20_000, bidAt: 1000, askAt: 20_000 }]]);
        expect(valueOpenPositions([position()], instruments, partial, 20_000).openPnl).toBeNull();
        expect(valueOpenPositions([position({ netPos: -2 })], instruments, partial, 20_000).openPnl).toBe(-110);
    });
});

class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    sent: string[] = [];
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) { Socket.instances.push(this); }
    send(value: string) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.(); }
    emit(data: string) { this.onmessage?.({ data }); }
}

describe('read-only quote stream', () => {
    let stream: TradovateOpenPnlStream;
    afterEach(() => { stream?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });
    function setup() {
        vi.useFakeTimers(); vi.setSystemTime(2000); vi.stubGlobal('WebSocket', Socket); Socket.instances = [];
        stream = new TradovateOpenPnlStream('test-token', async () => ({ valuePerPoint: 5, currency: 'USD' }), vi.fn());
        stream.updatePositions([position(), position({ id: 2, accountId: 11 })]);
        const socket = Socket.instances[0]; socket.emit('o'); socket.emit('a[{"i":1,"s":200}]');
        return socket;
    }

    it('subscribes once for copied accounts, handles incremental quotes and unsubscribes when flat', async () => {
        const socket = setup(); await vi.advanceTimersByTimeAsync(100);
        expect(socket.url).toBe('wss://md.tradovateapi.com/v1/websocket');
        expect(socket.sent.filter(message => message.startsWith('md/subscribeQuote'))).toHaveLength(1);
        socket.emit('a[{"i":2,"s":200},{"e":"md","d":{"quotes":[{"contractId":20,"timestamp":"1970-01-01T00:00:02Z","entries":{"Bid":{"price":110}}}]}}]');
        expect(stream.valuation(10).openPnl).toBe(100);
        socket.emit('a[{"e":"md","d":{"quotes":[{"contractId":20,"timestamp":"1970-01-01T00:00:02.050Z","entries":{"Offer":{"price":111}}}]}}]');
        expect(stream.valuation(10).openPnl).toBe(100);
        stream.updatePositions([]);
        expect(socket.sent.some(message => message.startsWith('md/unsubscribeQuote'))).toBe(true);
        expect(socket.readyState).toBe(3);
        expect(stream.valuation(10).openPnl).toBe(0);
    });

    it('fails closed on permission rejection and stops reconnecting after disposal', async () => {
        const socket = setup();
        socket.emit('a[{"i":2,"s":403}]'); await vi.advanceTimersByTimeAsync(100);
        expect(stream.valuation(10).openPnlState).toBe('unavailable');
        expect(stream.valuation(10).openPnl).toBeNull();
        socket.close(); stream.dispose(); await vi.advanceTimersByTimeAsync(60_000);
        expect(Socket.instances).toHaveLength(1);
    });
});
