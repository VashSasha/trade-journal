import { Trade, TradeDirection } from '../../../core/models/trade.model';
import { inferTradeDecisions } from '../../../core/utils/trade-decisions.utils';
import { tradeSessionDateStr } from '../../../core/utils/market-holidays';

export type AnalyticsUnit = 'decision' | 'position' | 'execution';

/** A normalized result consumed by Analytics widgets. */
export interface AnalyticsObservation {
    id: string;
    trades: readonly Trade[];
    representative: Trade;
    pnl: number;
    entryTimestamp: number;
    exitTimestamp: number;
    symbol: string;
    direction: TradeDirection;
    setup: string | null;
    accountCount: number;
    executionCount: number;
}

export interface AnalyticsPerformance {
    count: number;
    netPnl: number;
    winners: number;
    losers: number;
    breakeven: number;
    winRate: number;
    profitFactor: number;
    profitFactorInfinite: boolean;
    expectancy: number;
    averageWin: number;
    averageLoss: number;
    maxDrawdown: number;
    bestStreak: number;
    worstStreak: number;
    best: AnalyticsObservation | null;
    worst: AnalyticsObservation | null;
}

export interface MonthlyPerformance {
    month: number;
    pnl: number;
    count: number;
    winners: number;
    losers: number;
    winRate: number;
    intensity: number;
}

export interface AnnualPerformance {
    year: number;
    months: MonthlyPerformance[];
    pnl: number;
    count: number;
    winners: number;
    losers: number;
    winRate: number;
}

interface MutablePosition {
    trades: Trade[];
    accountKey: string;
    hasAccountIdentity: boolean;
    symbol: string;
    direction: TradeDirection;
    entryTimestamp: number;
    exitTimestamp: number;
}

export function analyticsUnitLabel(unit: AnalyticsUnit, plural = true): string {
    const labels: Record<AnalyticsUnit, [string, string]> = {
        decision: ['decision', 'decisions'],
        position: ['position', 'positions'],
        execution: ['execution', 'executions'],
    };
    return labels[unit][plural ? 1 : 0];
}

/**
 * Convert account-level trade rows into the selected analytics lens. Decision
 * mode groups conservative copy-trade matches; execution mode keeps every row.
 * In either mode, summing `pnl` produces the same combined-account P&L.
 */
export function buildAnalyticsObservations(
    trades: readonly Trade[],
    unit: AnalyticsUnit,
): AnalyticsObservation[] {
    const closed = trades.filter(trade =>
        trade.status === 'closed' && Number.isFinite(trade.netPnl ?? trade.pnl),
    );

    if (unit === 'execution') {
        return closed
            .map((trade, index) => toExecutionObservation(trade, index))
            .sort(byRealizationTime);
    }

    if (unit === 'position') {
        return buildPositionObservations(closed);
    }

    return inferTradeDecisions(closed).decisions
        .map((decision, index): AnalyticsObservation => {
            const representative = decision.trades[0];
            const entryTimestamp = decision.entryTimestamp
                ?? parseTradeTimestamp(representative.entryDate, representative.entryTime);
            const exitTimestamp = decision.exitTimestamp
                || parseTradeTimestamp(representative.exitDate, representative.exitTime)
                || entryTimestamp;
            const setup = decision.trades.find(trade => trade.setup?.trim())?.setup?.trim() ?? null;

            return {
                id: `decision:${index}:${representative.id}`,
                trades: decision.trades,
                representative,
                pnl: decision.totalPnl,
                entryTimestamp,
                exitTimestamp,
                symbol: representative.symbol,
                direction: representative.direction,
                setup,
                accountCount: decision.accountIds.length || 1,
                executionCount: decision.trades.length,
            };
        })
        .sort(byRealizationTime);
}

/**
 * Infer one account position from overlapping matched trade intervals. This
 * combines scale-ins and partial exits while deliberately keeping non-
 * overlapping same-symbol trades separate, even when only seconds apart.
 */
function buildPositionObservations(trades: readonly Trade[]): AnalyticsObservation[] {
    const sorted = trades
        .map((trade, index) => ({
            trade,
            index,
            entryTimestamp: parseTradeTimestamp(trade.entryDate, trade.entryTime),
            exitTimestamp: parseTradeTimestamp(trade.exitDate, trade.exitTime)
                || parseTradeTimestamp(trade.entryDate, trade.entryTime),
        }))
        .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
    const groups: MutablePosition[] = [];

    for (const item of sorted) {
        const identity = tradeAccountKey(item.trade, item.index);
        const symbol = item.trade.symbol.trim().toUpperCase();
        let match: MutablePosition | undefined;

        if (identity.hasAccountIdentity && item.entryTimestamp > 0 && item.exitTimestamp > item.entryTimestamp) {
            for (let index = groups.length - 1; index >= 0; index--) {
                const candidate = groups[index];
                if (candidate.accountKey !== identity.key || candidate.symbol !== symbol) continue;
                if (candidate.direction !== item.trade.direction) continue;
                if (item.entryTimestamp >= candidate.exitTimestamp) continue;
                if (item.exitTimestamp <= candidate.entryTimestamp) continue;
                match = candidate;
                break;
            }
        }

        if (match) {
            match.trades.push(item.trade);
            match.entryTimestamp = Math.min(match.entryTimestamp, item.entryTimestamp);
            match.exitTimestamp = Math.max(match.exitTimestamp, item.exitTimestamp);
        } else {
            groups.push({
                trades: [item.trade],
                accountKey: identity.key,
                hasAccountIdentity: identity.hasAccountIdentity,
                symbol,
                direction: item.trade.direction,
                entryTimestamp: item.entryTimestamp,
                exitTimestamp: item.exitTimestamp,
            });
        }
    }

    return groups.map((group, index): AnalyticsObservation => {
        const representative = group.trades[0];
        return {
            id: `position:${index}:${representative.id}`,
            trades: group.trades,
            representative,
            pnl: group.trades.reduce((sum, trade) => sum + (trade.netPnl ?? trade.pnl ?? 0), 0),
            entryTimestamp: group.entryTimestamp,
            exitTimestamp: group.exitTimestamp,
            symbol: representative.symbol,
            direction: representative.direction,
            setup: group.trades.find(trade => trade.setup?.trim())?.setup?.trim() ?? null,
            accountCount: group.hasAccountIdentity ? 1 : 0,
            executionCount: group.trades.length,
        };
    }).sort(byRealizationTime);
}

export function computeAnalyticsPerformance(
    trades: readonly Trade[],
    unit: AnalyticsUnit,
): AnalyticsPerformance {
    const observations = buildAnalyticsObservations(trades, unit);
    const winners = observations.filter(observation => observation.pnl > 0);
    const losers = observations.filter(observation => observation.pnl < 0);
    const grossWins = winners.reduce((sum, observation) => sum + observation.pnl, 0);
    const grossLosses = Math.abs(losers.reduce((sum, observation) => sum + observation.pnl, 0));
    const netPnl = observations.reduce((sum, observation) => sum + observation.pnl, 0);
    const profitFactorInfinite = grossLosses === 0 && grossWins > 0;

    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let bestStreak = 0;
    let worstStreak = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const observation of observations) {
        equity += observation.pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity - peak);

        if (observation.pnl > 0) {
            currentWins++;
            currentLosses = 0;
            bestStreak = Math.max(bestStreak, currentWins);
        } else if (observation.pnl < 0) {
            currentLosses++;
            currentWins = 0;
            worstStreak = Math.max(worstStreak, currentLosses);
        } else {
            currentWins = 0;
            currentLosses = 0;
        }
    }

    const best = observations.length
        ? observations.reduce((candidate, observation) => observation.pnl > candidate.pnl ? observation : candidate)
        : null;
    const worst = observations.length
        ? observations.reduce((candidate, observation) => observation.pnl < candidate.pnl ? observation : candidate)
        : null;

    return {
        count: observations.length,
        netPnl,
        winners: winners.length,
        losers: losers.length,
        breakeven: observations.length - winners.length - losers.length,
        winRate: observations.length ? (winners.length / observations.length) * 100 : 0,
        profitFactor: grossLosses > 0 ? grossWins / grossLosses : 0,
        profitFactorInfinite,
        expectancy: observations.length ? netPnl / observations.length : 0,
        averageWin: winners.length ? grossWins / winners.length : 0,
        averageLoss: losers.length ? -grossLosses / losers.length : 0,
        maxDrawdown,
        bestStreak,
        worstStreak,
        best,
        worst,
    };
}

/** Build newest-first calendar-year rows using the app's trading-session date. */
export function buildAnnualPerformance(
    trades: readonly Trade[],
    unit: AnalyticsUnit,
): AnnualPerformance[] {
    const years = new Map<number, MonthlyPerformance[]>();

    for (const observation of buildAnalyticsObservations(trades, unit)) {
        if (observation.exitTimestamp <= 0) continue;
        const sessionDate = tradeSessionDateStr(new Date(observation.exitTimestamp).toISOString());
        const [yearValue, monthValue] = sessionDate.split('-').map(Number);
        if (!Number.isInteger(yearValue) || !Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
            continue;
        }

        const months = years.get(yearValue) ?? Array.from({ length: 12 }, (_, month) => ({
            month,
            pnl: 0,
            count: 0,
            winners: 0,
            losers: 0,
            winRate: 0,
            intensity: 0,
        }));
        const bucket = months[monthValue - 1];
        bucket.pnl += observation.pnl;
        bucket.count++;
        if (observation.pnl > 0) bucket.winners++;
        if (observation.pnl < 0) bucket.losers++;
        years.set(yearValue, months);
    }

    const maxAbsoluteMonthlyPnl = Math.max(
        0,
        ...[...years.values()].flat().map(month => Math.abs(month.pnl)),
    );

    return [...years.entries()]
        .map(([year, months]): AnnualPerformance => {
            for (const month of months) {
                month.winRate = month.count ? (month.winners / month.count) * 100 : 0;
                month.intensity = month.pnl === 0 || maxAbsoluteMonthlyPnl === 0
                    ? 0
                    : Math.max(1, Math.ceil((Math.abs(month.pnl) / maxAbsoluteMonthlyPnl) * 4));
            }
            const count = months.reduce((sum, month) => sum + month.count, 0);
            const winners = months.reduce((sum, month) => sum + month.winners, 0);
            const losers = months.reduce((sum, month) => sum + month.losers, 0);
            return {
                year,
                months,
                pnl: months.reduce((sum, month) => sum + month.pnl, 0),
                count,
                winners,
                losers,
                winRate: count ? (winners / count) * 100 : 0,
            };
        })
        .sort((left, right) => right.year - left.year);
}

function toExecutionObservation(trade: Trade, index: number): AnalyticsObservation {
    const entryTimestamp = parseTradeTimestamp(trade.entryDate, trade.entryTime);
    const exitTimestamp = parseTradeTimestamp(trade.exitDate, trade.exitTime) || entryTimestamp;
    const hasAccount = Boolean((trade.accountId && trade.accountId !== '0') || trade.accountName);
    return {
        id: `execution:${trade.id || index}`,
        trades: [trade],
        representative: trade,
        pnl: trade.netPnl ?? trade.pnl ?? 0,
        entryTimestamp,
        exitTimestamp,
        symbol: trade.symbol,
        direction: trade.direction,
        setup: trade.setup?.trim() || null,
        accountCount: hasAccount ? 1 : 0,
        executionCount: 1,
    };
}

function tradeAccountKey(trade: Trade, index: number): { key: string; hasAccountIdentity: boolean } {
    const accountId = trade.accountId?.trim();
    if (accountId && accountId !== '0') return { key: `id:${accountId}`, hasAccountIdentity: true };
    const accountName = trade.accountName?.trim().toLowerCase();
    if (accountName) return { key: `name:${accountName}`, hasAccountIdentity: true };
    return { key: `unknown:${trade.id}:${index}`, hasAccountIdentity: false };
}

function parseTradeTimestamp(date: string | undefined, time: string | undefined): number {
    if (!date) return 0;
    const value = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? `${date}T${time || '12:00:00'}`
        : date;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function byRealizationTime(left: AnalyticsObservation, right: AnalyticsObservation): number {
    return left.exitTimestamp - right.exitTimestamp || left.entryTimestamp - right.entryTimestamp;
}
