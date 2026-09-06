import { Trade } from '../models/trade.model';
import { tradeSessionDateStr } from './market-holidays';

export interface DayStats {
    totalTrades: number;
    netPnl: number;
    grossPnl: number;
    commissions: number;
    winners: number;
    losers: number;
    breakeven: number;
    winRate: number;
    totalVolume: number;
    avgNetPnl: number;
    bestTrade: Trade | null;
    worstTrade: Trade | null;
}

export interface EquityCurve {
    labels: string[];
    values: number[];
}

export type EquityCurveGrouping = 'trade' | 'hour' | 'day';

export function computeDayStats(trades: Trade[]): DayStats {
    const closed = trades.filter(t => t.status === 'closed');
    const netPnl = closed.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const commissions = closed.reduce((sum, t) => sum + (t.fees ?? 0), 0);
    const totalVolume = closed.reduce((sum, t) => sum + (t.quantity ?? 0), 0);
    const winners = closed.filter(t => (t.netPnl ?? t.pnl ?? 0) > 0).length;
    const losers = closed.filter(t => (t.netPnl ?? t.pnl ?? 0) < 0).length;
    const breakeven = closed.length - winners - losers;
    const winRate = closed.length > 0 ? (winners / closed.length) * 100 : 0;
    const avgNetPnl = closed.length > 0 ? netPnl / closed.length : 0;

    let bestTrade: Trade | null = null;
    let worstTrade: Trade | null = null;
    if (closed.length > 0) {
        bestTrade  = closed.reduce((best, t)  => (t.netPnl ?? t.pnl ?? 0) > (best.netPnl ?? best.pnl ?? 0) ? t : best, closed[0]);
        worstTrade = closed.reduce((worst, t) => (t.netPnl ?? t.pnl ?? 0) < (worst.netPnl ?? worst.pnl ?? 0) ? t : worst, closed[0]);
    }

    return { totalTrades: closed.length, netPnl, grossPnl, commissions, winners, losers, breakeven, winRate, totalVolume, avgNetPnl, bestTrade, worstTrade };
}

/**
 * Balance at the start of a given trading day.
 *
 * = base (opening/funded balance) + Σ netPnl of closed trades whose CME
 *   session date is STRICTLY BEFORE cutoffDate (YYYY-MM-DD).
 *
 * Used by the journal day-view and anywhere else a windowed equity anchor
 * is needed. Pre-filters to closed trades with netPnl; callers are
 * responsible for scoping `trades` to the relevant accounts first.
 */
export function computeWindowedBalance(base: number, trades: Trade[], cutoffDate: string): number {
    return base + trades
        .filter(t => {
            if (t.status !== 'closed' || t.netPnl === undefined) return false;
            const dateKey = t.exitDate ?? t.entryDate;
            if (!dateKey) return false;
            return tradeSessionDateStr(dateKey) < cutoffDate;
        })
        .reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
}

export function buildEquityCurve(trades: Trade[], startingBalance = 0): EquityCurve {
    const sorted = [...trades]
        .filter(t => t.status === 'closed')
        .sort((a, b) => {
            const aKey = `${a.entryDate}T${a.entryTime ?? '00:00'}`;
            const bKey = `${b.entryDate}T${b.entryTime ?? '00:00'}`;
            return aKey.localeCompare(bKey);
        });

    const labels: string[] = ['Start'];
    const values: number[] = [startingBalance];
    let cumulative = startingBalance;

    sorted.forEach((t, i) => {
        cumulative += (t.netPnl ?? t.pnl ?? 0);
        labels.push(t.entryTime ? t.entryTime.substring(0, 5) : `#${i + 1}`);
        values.push(Math.round(cumulative * 100) / 100);
    });

    return { labels, values };
}

/** Dashboard equity series grouped by realization time and anchored to an opening balance. */
export function buildPerformanceEquityCurve(
    trades: Trade[],
    startingBalance: number,
    grouping: EquityCurveGrouping,
): EquityCurve {
    const closed = [...trades]
        .filter(trade => trade.status === 'closed' && trade.netPnl !== undefined)
        .sort((left, right) => new Date(left.exitDate ?? left.entryDate).getTime()
            - new Date(right.exitDate ?? right.entryDate).getTime());
    const points: Array<{ label: string; pnl: number; timestamp: number }> = [];

    if (grouping === 'trade') {
        for (const trade of closed) {
            const date = new Date(trade.exitDate ?? trade.entryDate);
            points.push({
                label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                pnl: trade.netPnl ?? 0,
                timestamp: date.getTime(),
            });
        }
    } else {
        const grouped = new Map<string, { date: Date; pnl: number }>();
        for (const trade of closed) {
            const realizedAt = new Date(trade.exitDate ?? trade.entryDate);
            const key = grouping === 'hour'
                ? new Date(realizedAt.getFullYear(), realizedAt.getMonth(), realizedAt.getDate(), realizedAt.getHours()).toISOString()
                : tradeSessionDateStr(realizedAt.toISOString());
            const date = grouping === 'hour' ? new Date(key) : new Date(`${key}T12:00:00`);
            const current = grouped.get(key);
            grouped.set(key, { date, pnl: (current?.pnl ?? 0) + (trade.netPnl ?? 0) });
        }
        for (const { date, pnl } of grouped.values()) {
            points.push({
                label: grouping === 'hour'
                    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
                    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                pnl,
                timestamp: date.getTime(),
            });
        }
        points.sort((left, right) => left.timestamp - right.timestamp);
    }

    let cumulative = startingBalance;
    const labels = ['Start'];
    const values = [Math.round(cumulative * 100) / 100];
    for (const point of points) {
        cumulative += point.pnl;
        labels.push(point.label);
        values.push(Math.round(cumulative * 100) / 100);
    }
    return { labels, values };
}
