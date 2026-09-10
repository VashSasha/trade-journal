import { TradovateLivePositionEventKind } from '../integrations/tradovate-live/tradovate-live.models';

export interface LiveCoachPreferences {
    enabled: boolean;
    aiCommentary: boolean;
    entries: boolean;
    sizing: boolean;
    exits: boolean;
    guardrails: boolean;
    cooldownSeconds: number;
    speechRate: number;
}

export interface LiveCoachNarration {
    key: string;
    title: string;
    text: string;
    tone: 'info' | 'warning';
    kind: TradovateLivePositionEventKind;
    accountCount: number;
    previousQuantity: number;
    quantity: number;
    personalized: boolean;
}

export type LiveCoachAiState = 'off' | 'ready' | 'thinking' | 'fallback';

/** Bounded, identity-free context sent to the paid AI proxy. */
export interface LiveCoachAiPayload {
    observation: {
        kind: TradovateLivePositionEventKind;
        symbol: string;
        direction: 'long' | 'short';
        previousQuantity: number;
        quantity: number;
        accountCount: number;
        averagePrice: number | null;
    };
    session: {
        tradeDate: string | null;
        dailyPnl: number;
        weeklyPnl: number;
        executionCount: number;
        decisionCount: number;
        accountCount: number;
        winRate: number;
        consecutiveLosses: number;
        recentDecisionPnls: number[];
        typicalContractsPerAccount: number | null;
        currentContractsPerAccount: number;
    };
}

export const DEFAULT_LIVE_COACH_PREFERENCES: Readonly<LiveCoachPreferences> = {
    enabled: false,
    aiCommentary: false,
    entries: true,
    sizing: true,
    exits: true,
    guardrails: true,
    cooldownSeconds: 10,
    speechRate: 1,
};
