import { Trade } from '../../../../core/models/trade.model';

const ENTRY_TOLERANCE_MS = 15_000;
const EXIT_TOLERANCE_MS = 30_000;

export interface InferredTradeDecision {
    trades: Trade[];
    accountIds: string[];
    entryTimestamp: number | null;
    exitTimestamp: number | null;
    totalPnl: number;
    averagePnl: number;
    totalQuantity: number;
    minQuantity: number;
    maxQuantity: number;
    mirrored: boolean;
}

export interface TradeDecisionSummary {
    decisions: InferredTradeDecision[];
    executionCount: number;
    decisionCount: number;
    accountCount: number;
    mirroredDecisionCount: number;
    mirroredExecutionCount: number;
    winners: number;
    losers: number;
    breakeven: number;
    winRate: number;
}

interface MutableDecision {
    trades: Trade[];
    accountIds: Set<string>;
    entryTimestamp: number | null;
    exitTimestamp: number | null;
}

/**
 * Infer the trader's underlying decisions without changing the canonical trade
 * count. Copy-traded executions are grouped only when they belong to different
 * accounts and have the same symbol/direction with near-identical entry and
 * exit times. Missing account identity always stays independent.
 */
export function inferTradeDecisions(trades: readonly Trade[]): TradeDecisionSummary {
    const sorted = [...trades].sort((left, right) => {
        const leftTime = tradeTimestamp(left.entryDate, left.entryTime);
        const rightTime = tradeTimestamp(right.entryDate, right.entryTime);
        return (leftTime ?? Number.MAX_SAFE_INTEGER) - (rightTime ?? Number.MAX_SAFE_INTEGER);
    });
    const groups: MutableDecision[] = [];

    for (const trade of sorted) {
        const accountId = tradeAccountId(trade);
        const entryTimestamp = tradeTimestamp(trade.entryDate, trade.entryTime);
        const exitTimestamp = tradeTimestamp(trade.exitDate, trade.exitTime);
        let best: MutableDecision | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        // Account identity is required for conservative copy-trade inference.
        if (accountId && entryTimestamp !== null) {
            for (let index = groups.length - 1; index >= 0; index--) {
                const candidate = groups[index];
                if (candidate.entryTimestamp === null) continue;
                const entryDistance = Math.abs(entryTimestamp - candidate.entryTimestamp);
                if (entryTimestamp >= candidate.entryTimestamp && entryDistance > ENTRY_TOLERANCE_MS) break;
                if (!decisionMatches(candidate, trade, accountId, entryTimestamp, exitTimestamp)) continue;

                const exitDistance = exitTimestamp !== null && candidate.exitTimestamp !== null
                    ? Math.abs(exitTimestamp - candidate.exitTimestamp)
                    : 0;
                const distance = entryDistance + exitDistance;
                if (distance < bestDistance) {
                    best = candidate;
                    bestDistance = distance;
                }
            }
        }

        if (best && accountId) {
            best.trades.push(trade);
            best.accountIds.add(accountId);
        } else {
            groups.push({
                trades: [trade],
                accountIds: new Set(accountId ? [accountId] : []),
                entryTimestamp,
                exitTimestamp,
            });
        }
    }

    const decisions = groups.map(toDecision);
    const accountIds = new Set(trades.map(tradeAccountId).filter((id): id is string => id !== null));
    const winners = decisions.filter(decision => decision.totalPnl > 0).length;
    const losers = decisions.filter(decision => decision.totalPnl < 0).length;

    return {
        decisions,
        executionCount: trades.length,
        decisionCount: decisions.length,
        accountCount: accountIds.size || (trades.length > 0 ? 1 : 0),
        mirroredDecisionCount: decisions.filter(decision => decision.mirrored).length,
        mirroredExecutionCount: decisions
            .filter(decision => decision.mirrored)
            .reduce((total, decision) => total + decision.trades.length, 0),
        winners,
        losers,
        breakeven: decisions.length - winners - losers,
        winRate: decisions.length ? (winners / decisions.length) * 100 : 0,
    };
}

function decisionMatches(
    candidate: MutableDecision,
    trade: Trade,
    accountId: string,
    entryTimestamp: number,
    exitTimestamp: number | null,
): boolean {
    const representative = candidate.trades[0];
    if (candidate.accountIds.has(accountId)) return false;
    if (representative.symbol.trim().toUpperCase() !== trade.symbol.trim().toUpperCase()) return false;
    if (representative.direction !== trade.direction || representative.status !== trade.status) return false;
    if (Math.abs(entryTimestamp - candidate.entryTimestamp!) > ENTRY_TOLERANCE_MS) return false;

    if (candidate.exitTimestamp === null || exitTimestamp === null) {
        return candidate.exitTimestamp === exitTimestamp;
    }
    return Math.abs(exitTimestamp - candidate.exitTimestamp) <= EXIT_TOLERANCE_MS;
}

function toDecision(group: MutableDecision): InferredTradeDecision {
    const totalPnl = group.trades.reduce((total, trade) => total + (trade.netPnl ?? trade.pnl ?? 0), 0);
    const quantities = group.trades.map(trade => Math.max(0, Number(trade.quantity) || 0));
    return {
        trades: group.trades,
        accountIds: [...group.accountIds],
        entryTimestamp: group.entryTimestamp,
        exitTimestamp: group.exitTimestamp,
        totalPnl,
        averagePnl: group.trades.length ? totalPnl / group.trades.length : 0,
        totalQuantity: quantities.reduce((total, quantity) => total + quantity, 0),
        minQuantity: quantities.length ? Math.min(...quantities) : 0,
        maxQuantity: quantities.length ? Math.max(...quantities) : 0,
        mirrored: group.trades.length > 1 && group.accountIds.size > 1,
    };
}

function tradeAccountId(trade: Trade): string | null {
    const id = trade.accountId?.trim();
    if (id && id !== '0') return id;
    const name = trade.accountName?.trim().toLowerCase();
    return name ? `name:${name}` : null;
}

function tradeTimestamp(date: string | undefined, time: string | undefined): number | null {
    if (!date) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !time) return null;
    const value = /^\d{4}-\d{2}-\d{2}$/.test(date) && time ? `${date}T${time}` : date;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}
