import { Trade } from '../../../core/models/trade.model';
import { computeDayStats } from '../../../core/utils/trade-stats.utils';
import { inferTradeDecisions } from '../../../core/utils/trade-decisions.utils';
import { tradeSessionDateStr } from '../../../core/utils/market-holidays';
import { LiveCoachAiPayload, LiveCoachFollowUpAnswer } from '../live-coach.models';

export interface CoachChatObservation {
    id: string; observedAt: string; title: string; text: string; snapshot: LiveCoachAiPayload | null;
}

export interface CoachChatContext {
    capturedAt: string;
    tradeDate: string;
    accountIds: string[] | null;
    dataReady: boolean;
    summary: { tradeCount: number; decisionCount: number; accountCount: number; netPnl: number; winRate: number; averageContracts: number; maxContracts: number } | null;
    /** A historical observation, not a claim that the position is still open. */
    replyTo?: CoachChatObservation;
}
export interface CoachConversation { id: string; title: string; created_at: string; }
export interface CoachChatTurn {
    id: string; conversation_id: string; prompt: string; answer: LiveCoachFollowUpAnswer; context: CoachChatContext; created_at: string;
}
export interface CoachChatRequest { conversationId: string; turnId: string; message: string; context: CoachChatContext; }

export function captureChatContext(trades: readonly Trade[], userId: string, tradeDate: string, accountIds: string[] | null, dataReady: boolean, now = new Date()): CoachChatContext {
    const closed = dataReady ? trades.filter(trade => trade.userId === userId && trade.status === 'closed'
        && (accountIds === null || accountIds.includes(trade.accountId ?? ''))
        && tradeSessionDateStr(trade.exitDate ?? trade.entryDate) === tradeDate) : [];
    const stats = computeDayStats(closed), decisions = inferTradeDecisions(closed);
    return { capturedAt: now.toISOString(), tradeDate, accountIds: accountIds === null ? null : [...accountIds], dataReady,
        summary: closed.length ? { tradeCount: closed.length, decisionCount: decisions.decisionCount, accountCount: decisions.accountCount,
            netPnl: stats.netPnl, winRate: stats.winRate, averageContracts: stats.totalVolume / closed.length,
            maxContracts: closed.reduce((max, trade) => Math.max(max, trade.quantity), 0) } : null };
}
