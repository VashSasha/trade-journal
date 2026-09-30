import { tradeSessionDateStr } from '../../../core/utils/market-holidays';
import { readCoachFollowUp } from '../live-coach-follow-up.utils';
import { LiveCoachAiPayload, LiveCoachFollowUpAnswer, LiveCoachObservation } from '../live-coach.models';

export interface SavedCoachObservation {
    id: string;
    observed_at: string;
    trade_date: string;
    title: string;
    content: string;
    personalized: boolean;
    snapshot: LiveCoachAiPayload | null;
    explanation: LiveCoachFollowUpAnswer | null;
    session_comparison: LiveCoachFollowUpAnswer | null;
}

export const HISTORY_COLUMNS = 'id,observed_at,trade_date,title,content,personalized,snapshot,explanation,session_comparison';
export const HISTORY_PAGE_SIZE = 30;

/** Explicit allowlist: never persist an event object, audio or broker credentials. */
export function captureCoachSnapshot(value?: LiveCoachAiPayload | null): LiveCoachAiPayload | null {
    if (!value?.observation || !value.session) return null;
    const o = value.observation, s = value.session;
    return {
        observation: { kind: o.kind, symbol: o.symbol, direction: o.direction,
            previousQuantity: o.previousQuantity, quantity: o.quantity, accountCount: o.accountCount, averagePrice: o.averagePrice },
        session: { tradeDate: s.tradeDate, dailyPnl: s.dailyPnl, weeklyPnl: s.weeklyPnl,
            executionCount: s.executionCount, decisionCount: s.decisionCount, accountCount: s.accountCount,
            winRate: s.winRate, consecutiveLosses: s.consecutiveLosses,
            recentDecisionPnls: [...s.recentDecisionPnls], typicalContractsPerAccount: s.typicalContractsPerAccount,
            currentContractsPerAccount: s.currentContractsPerAccount },
    };
}

export function observationToHistory(comment: LiveCoachObservation): SavedCoachObservation {
    if (!comment.historyId) throw new Error('Missing saved observation ID.');
    const observed_at = new Date(comment.time).toISOString();
    return {
        id: comment.historyId, observed_at,
        trade_date: comment.snapshot?.session.tradeDate || tradeSessionDateStr(observed_at),
        title: comment.title, content: comment.text, personalized: comment.personalized,
        snapshot: captureCoachSnapshot(comment.snapshot), explanation: null, session_comparison: null,
    };
}

export function readHistoryRow(row: SavedCoachObservation): SavedCoachObservation {
    return { ...row, explanation: readCoachFollowUp(row.explanation), session_comparison: readCoachFollowUp(row.session_comparison) };
}
