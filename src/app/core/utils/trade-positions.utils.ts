import { Trade } from '../models/trade.model';
import { inferTradeDecisions, tradeAccountId, tradeTimestamp, TradeDecisionSummary } from './trade-decisions.utils';

export interface TradePosition {
    trades: Trade[];
    aggregate: Trade;
    entryTimestamp: number | null;
    exitTimestamp: number | null;
    /** Incomplete identity/timing or a known still-open position. */
    uncertain: boolean;
}

export interface PositionActivity extends TradeDecisionSummary {
    positionCount: number;
    ungroupedExecutionCount: number;
    /** Display-only records: never persist these as broker trades. */
    groupedTrades: Trade[];
}

/** Aggregation preserves money/volume; quantity is matched volume, NOT peak exposure. */
export function aggregateTradeRows(trades: readonly Trade[], id: string): Trade {
    const first = trades[0];
    const entries = trades.map(t => tradeTimestamp(t.entryDate, t.entryTime)).filter((t): t is number => t !== null);
    const exits = trades.map(t => tradeTimestamp(t.exitDate, t.exitTime)).filter((t): t is number => t !== null);
    return {
        ...first, id,
        entryDate: entries.length ? new Date(Math.min(...entries)).toISOString() : first.entryDate,
        exitDate: exits.length ? new Date(Math.max(...exits)).toISOString() : first.exitDate,
        entryTime: undefined, exitTime: undefined,
        quantity: trades.reduce((sum, t) => sum + (t.quantity ?? 0), 0),
        pnl: trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
        netPnl: trades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0),
        fees: trades.reduce((sum, t) => sum + (t.fees ?? 0), 0),
    };
}

/**
 * Extracted from Analytics' position lens. Overlapping matched intervals on the
 * same owner/broker/connection/account/contract/direction form a position. There
 * is no time-gap tolerance: touching intervals may be flat/re-entry, so stay
 * separate. This is an estimate from available history, not an execution ledger.
 */
export function groupTradePositions(trades: readonly Trade[], context: readonly Trade[] = trades): TradePosition[] {
    const sorted = trades.filter(t => t.status === 'closed').map((trade, index) => ({
        trade, index, account: tradeAccountId(trade),
        entry: tradeTimestamp(trade.entryDate, trade.entryTime),
        exit: tradeTimestamp(trade.exitDate, trade.exitTime),
    })).sort((a, b) => (a.entry ?? Infinity) - (b.entry ?? Infinity) || a.index - b.index);
    const groups: Array<{ key: string; rows: Trade[]; entry: number | null; exit: number | null; uncertain: boolean }> = [];
    const latest = new Map<string, typeof groups[number]>();
    for (const item of sorted) {
        const { trade, account, entry, exit } = item;
        const key = positionKey(trade);
        const uncertain = !account || entry === null || exit === null || exit <= entry;
        const previous = latest.get(key);
        if (!uncertain && previous && !previous.uncertain && entry! < previous.exit! && exit! > previous.entry!) {
            previous.rows.push(trade);
            previous.exit = Math.max(previous.exit!, exit!);
        } else {
            const group = { key, rows: [trade], entry, exit, uncertain };
            groups.push(group);
            // An invalid row must not break a known, still-overlapping position.
            if (!uncertain) latest.set(key, group);
        }
    }
    // A matched partial exit can exist while other contracts are still open.
    // Preserve realized money, but do not assert a completed-trade limit breach.
    const openByKey = new Map<string, number>();
    for (const trade of context) {
        if (trade.status !== 'open' || !tradeAccountId(trade)) continue;
        const key = positionKey(trade);
        const entry = tradeTimestamp(trade.entryDate, trade.entryTime) ?? -Infinity;
        openByKey.set(key, Math.min(openByKey.get(key) ?? Infinity, entry));
    }
    return groups.map((g, index) => ({ trades: g.rows,
        aggregate: aggregateTradeRows(g.rows, `position:${index}:${g.rows[0].id}`),
        entryTimestamp: g.entry, exitTimestamp: g.exit,
        uncertain: g.uncertain || (g.exit !== null && (openByKey.get(g.key) ?? Infinity) < g.exit),
    })).sort((a, b) => (a.exitTimestamp ?? Infinity) - (b.exitTimestamp ?? Infinity));
}

/** Group scale-ins first, then matching copied positions. Keep original rows for all financial calculations. */
export function inferPositionActivity(trades: readonly Trade[], context: readonly Trade[] = trades): PositionActivity {
    const positions = groupTradePositions(trades, context);
    const lookup = new Map(positions.map(p => [p.aggregate.id, p]));
    const activity = inferTradeDecisions(positions.map(p => p.aggregate), t => !lookup.get(t.id)!.uncertain);
    const decisions = activity.decisions.map(decision => {
        const rows = decision.trades.flatMap(t => lookup.get(t.id)!.trades);
        return { ...decision, trades: rows, averagePnl: decision.totalPnl / rows.length };
    }).sort((a, b) => (a.exitTimestamp ?? Infinity) - (b.exitTimestamp ?? Infinity));
    return { ...activity, decisions,
        executionCount: positions.reduce((sum, p) => sum + p.trades.length, 0),
        mirroredExecutionCount: decisions.filter(d => d.mirrored).reduce((sum, d) => sum + d.trades.length, 0),
        positionCount: positions.length,
        ungroupedExecutionCount: positions.filter(p => p.uncertain).reduce((sum, p) => sum + p.trades.length, 0),
        groupedTrades: decisions.map((d, index) => aggregateTradeRows(d.trades, `grouped:${index}:${d.trades[0].id}`)),
    };
}

function positionKey(trade: Trade): string {
    return JSON.stringify([trade.userId, trade.source ?? 'manual', trade.connectionId ?? '', tradeAccountId(trade),
        trade.symbol.trim().toUpperCase(), trade.direction]);
}
