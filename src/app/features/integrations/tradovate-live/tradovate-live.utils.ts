import type { TradovateCashBalance } from '../../../core/services/tradovate.service';
import {
    TradovateLiveAccountMetric,
    TradovateLivePositionEvent,
    TradovateSocketFrame,
    TradovateSocketResponse,
} from './tradovate-live.models';

type UnknownRecord = Record<string, unknown>;

interface LivePosition {
    id: number;
    accountId: number;
    contractId: number | null;
    netPos: number;
    netPrice: number | null;
    tradeDate: string | null;
}

interface CashBalanceProjection {
    changed: boolean;
    balance: TradovateCashBalance | null;
}

export interface TradovateLiveUpdate {
    changed: boolean;
    completedAccountIds: number[];
    balances: TradovateCashBalance[];
    positionEvents: TradovateLivePositionEvent[];
}

const EMPTY_UPDATE: TradovateLiveUpdate = {
    changed: false,
    completedAccountIds: [],
    balances: [],
    positionEvents: [],
};

function record(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function optionalNumber(value: unknown): number | undefined {
    return finiteNumber(value) ?? undefined;
}

/** Converts Tradovate's { year, month, day } shape (or ISO text) to YYYY-MM-DD. */
export function tradovateTradeDate(value: unknown): string | null {
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    }
    const date = record(value);
    if (!date) return null;
    const year = finiteNumber(date['year']);
    const month = finiteNumber(date['month']);
    const day = finiteNumber(date['day']);
    if (year === null || month === null || day === null) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parses Tradovate's SockJS-style o/h/a/c framing without throwing on bad input. */
export function parseTradovateSocketFrame(raw: unknown): TradovateSocketFrame {
    if (typeof raw !== 'string' || raw.length === 0) return { type: 'invalid' };
    if (raw === 'o') return { type: 'open' };
    if (raw === 'h') return { type: 'heartbeat' };
    if (raw[0] === 'c') return { type: 'close' };
    if (raw[0] !== 'a') return { type: 'invalid' };
    try {
        const payload: unknown = JSON.parse(raw.slice(1));
        if (!Array.isArray(payload)) return { type: 'invalid' };
        return {
            type: 'messages',
            messages: payload.filter(item => record(item) !== null) as TradovateSocketResponse[],
        };
    } catch {
        return { type: 'invalid' };
    }
}

/**
 * Stateful, transport-free projection of a user/syncrequest stream.
 * The initial response is always a baseline; only later flat/reversal position
 * transitions count as newly completed trades.
 */
export class TradovateLiveAccumulator {
    private positions = new Map<number, LivePosition>();
    private metrics = new Map<number, TradovateLiveAccountMetric>();
    private epochs = new Map<number, number>();
    private eventSequence = 0;

    constructor(
        private readonly connectionId: string,
        accountIds: number[],
        private readonly now: () => number = Date.now,
        private readonly baselineNamespace = '0',
    ) {
        for (const accountId of accountIds) this.resetAccount(accountId, null);
    }

    snapshot(): TradovateLiveAccountMetric[] {
        return [...this.metrics.values()].map(metric => ({ ...metric }));
    }

    replaceFromInitial(payload: unknown): TradovateLiveUpdate {
        const data = record(payload);
        if (!data) return { ...EMPTY_UPDATE };
        this.positions.clear();

        const accountIds = new Set(this.metrics.keys());
        for (const item of this.array(data['accounts'])) {
            const accountId = finiteNumber(record(item)?.['id']);
            if (accountId !== null) accountIds.add(accountId);
        }
        for (const item of this.array(data['cashBalances'])) {
            const accountId = finiteNumber(record(item)?.['accountId']);
            if (accountId !== null) accountIds.add(accountId);
        }
        for (const accountId of accountIds) this.resetAccount(accountId, null);

        const balances: TradovateCashBalance[] = [];
        for (const item of this.array(data['cashBalances'])) {
            const projection = this.applyCashBalance(item, true);
            if (projection.balance) balances.push(projection.balance);
        }
        for (const item of this.array(data['positions'])) this.storeInitialPosition(item);

        return { changed: true, completedAccountIds: [], balances, positionEvents: [] };
    }

    applyProps(payload: unknown): TradovateLiveUpdate {
        const event = record(payload);
        const entity = record(event?.['entity']);
        const entityType = typeof event?.['entityType'] === 'string'
            ? event['entityType'].toLowerCase()
            : '';
        if (!entity) return { ...EMPTY_UPDATE };

        if (entityType === 'cashbalance') {
            const projection = this.applyCashBalance(entity, false);
            return {
                changed: projection.changed,
                completedAccountIds: [],
                balances: projection.balance ? [projection.balance] : [],
                positionEvents: [],
            };
        }
        if (entityType === 'position') return this.applyPosition(entity);
        return { ...EMPTY_UPDATE };
    }

    private applyCashBalance(value: unknown, initial: boolean): CashBalanceProjection {
        const balance = record(value);
        const accountId = finiteNumber(balance?.['accountId']);
        if (!balance || accountId === null) return { changed: false, balance: null };

        const incomingDate = tradovateTradeDate(balance['tradeDate']);
        let current = this.metrics.get(accountId);
        if (!current || (!initial && incomingDate && incomingDate !== current.tradeDate)) {
            current = this.resetAccount(accountId, incomingDate);
        }

        const amount = finiteNumber(balance['amount']);
        const dailyPnl = finiteNumber(balance['realizedPnL']);
        const weeklyPnl = finiteNumber(balance['weekRealizedPnL']);
        const next: TradovateLiveAccountMetric = {
            ...current,
            tradeDate: incomingDate ?? current.tradeDate,
            dailyPnl: dailyPnl ?? current.dailyPnl,
            weeklyPnl: weeklyPnl ?? current.weeklyPnl,
            balance: amount ?? current.balance,
            updatedAt: this.now(),
        };
        if (next.tradeDate !== current.tradeDate) {
            const epoch = this.epochs.get(accountId) ?? 1;
            next.baselineKey = this.key(accountId, epoch, next.tradeDate);
        }
        this.metrics.set(accountId, next);

        return {
            changed: true,
            balance: amount === null ? null : {
                id: optionalNumber(balance['id']) ?? accountId,
                accountId,
                amount,
                currencyId: optionalNumber(balance['currencyId']),
                realizedPnL: dailyPnl ?? undefined,
                weekRealizedPnL: weeklyPnl ?? undefined,
            },
        };
    }

    private storeInitialPosition(value: unknown): void {
        const position = this.position(value);
        if (position) this.positions.set(position.id, position);
    }

    private applyPosition(value: unknown): TradovateLiveUpdate {
        const incoming = this.position(value);
        if (!incoming) return { ...EMPTY_UPDATE };
        const previous = this.positions.get(incoming.id);
        this.positions.set(incoming.id, incoming);
        if (!previous) {
            if (incoming.netPos === 0) return { ...EMPTY_UPDATE };
            return {
                ...EMPTY_UPDATE,
                positionEvents: [this.positionEvent(incoming, null, 'opened')],
            };
        }

        if (incoming.netPos === previous.netPos) return { ...EMPTY_UPDATE };

        const completed = previous.netPos !== 0
            && (incoming.netPos === 0 || Math.sign(previous.netPos) !== Math.sign(incoming.netPos));
        const kind = this.positionEventKind(previous.netPos, incoming.netPos);
        const positionEvent = this.positionEvent(incoming, previous, kind);
        if (!completed) {
            return { ...EMPTY_UPDATE, positionEvents: [positionEvent] };
        }

        let metric = this.metrics.get(incoming.accountId) ?? this.resetAccount(incoming.accountId, incoming.tradeDate);
        if (incoming.tradeDate && incoming.tradeDate !== metric.tradeDate) {
            metric = this.resetAccount(incoming.accountId, incoming.tradeDate);
        }
        this.metrics.set(incoming.accountId, {
            ...metric,
            completedTrades: metric.completedTrades + 1,
            updatedAt: this.now(),
        });
        return {
            changed: true,
            completedAccountIds: [incoming.accountId],
            balances: [],
            positionEvents: [positionEvent],
        };
    }

    private position(value: unknown): LivePosition | null {
        const entity = record(value);
        const id = finiteNumber(entity?.['id']);
        const accountId = finiteNumber(entity?.['accountId']);
        const netPos = finiteNumber(entity?.['netPos']);
        if (!entity || id === null || accountId === null || netPos === null) return null;
        return {
            id,
            accountId,
            contractId: finiteNumber(entity['contractId']),
            netPos,
            netPrice: finiteNumber(entity['netPrice']),
            tradeDate: tradovateTradeDate(entity['tradeDate']),
        };
    }

    private positionEventKind(previous: number, current: number): TradovateLivePositionEvent['kind'] {
        if (current === 0) return 'closed';
        if (previous === 0) return 'opened';
        if (Math.sign(previous) !== Math.sign(current)) return 'reversed';
        return Math.abs(current) > Math.abs(previous) ? 'increased' : 'reduced';
    }

    private positionEvent(
        incoming: LivePosition,
        previous: LivePosition | null,
        kind: TradovateLivePositionEvent['kind'],
    ): TradovateLivePositionEvent {
        const directionValue = kind === 'closed' ? previous?.netPos ?? incoming.netPos : incoming.netPos;
        const observedAt = this.now();
        return {
            eventId: `${this.connectionId}:${this.baselineNamespace}:${++this.eventSequence}:${observedAt}`,
            connectionId: this.connectionId,
            accountId: incoming.accountId,
            positionId: incoming.id,
            contractId: incoming.contractId ?? previous?.contractId ?? null,
            tradeDate: incoming.tradeDate ?? previous?.tradeDate ?? null,
            kind,
            direction: directionValue < 0 ? 'short' : 'long',
            previousQuantity: Math.abs(previous?.netPos ?? 0),
            quantity: Math.abs(incoming.netPos),
            averagePrice: incoming.netPrice ?? previous?.netPrice ?? null,
            observedAt,
        };
    }

    private resetAccount(accountId: number, tradeDate: string | null): TradovateLiveAccountMetric {
        const epoch = (this.epochs.get(accountId) ?? 0) + 1;
        this.epochs.set(accountId, epoch);
        const previous = this.metrics.get(accountId);
        const metric: TradovateLiveAccountMetric = {
            connectionId: this.connectionId,
            accountId,
            tradeDate,
            dailyPnl: null,
            weeklyPnl: null,
            balance: previous?.balance ?? null,
            completedTrades: 0,
            baselineKey: this.key(accountId, epoch, tradeDate),
            updatedAt: this.now(),
        };
        this.metrics.set(accountId, metric);
        return metric;
    }

    private key(accountId: number, epoch: number, tradeDate: string | null): string {
        return `${this.connectionId}:${accountId}:${this.baselineNamespace}:${epoch}:${tradeDate ?? 'unknown'}`;
    }

    private array(value: unknown): unknown[] {
        return Array.isArray(value) ? value : [];
    }
}
