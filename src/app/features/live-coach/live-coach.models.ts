import { TradovateLivePositionEventKind } from '../integrations/tradovate-live/tradovate-live.models';
import { DEFAULT_LIVE_COACH_VOICE, LiveCoachVoice } from './live-coach-voices';

export type { LiveCoachVoice } from './live-coach-voices';
export interface LiveCoachAudio { mimeType: 'audio/mpeg'; base64: string; }
export interface LiveCoachReply { text: string; audio?: LiveCoachAudio; voiceError?: string; followUp?: LiveCoachFollowUpAnswer; }

export type LiveCoachQuestion = 'explain' | 'compare-session';
export interface LiveCoachFollowUpAnswer { meaning: string; evidence: string; nextStep: string; }
export interface LiveCoachObservation {
    id: number;
    text: string;
    time: number;
    personalized: boolean;
    title: string;
    /** Captured once with the observation, never rebuilt when a question is clicked. */
    snapshot?: LiveCoachAiPayload;
}
export interface LiveCoachFollowUpPayload {
    question: LiveCoachQuestion;
    observedAt: string;
    comment: string;
    snapshot: LiveCoachAiPayload | null;
}

export interface LiveCoachPreferences {
    enabled: boolean;
    voiceEnabled: boolean;
    aiCommentary: boolean;
    entries: boolean;
    sizing: boolean;
    exits: boolean;
    guardrails: boolean;
    cooldownSeconds: number;
    speechRate: number;
    voice: LiveCoachVoice;
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
    audio?: LiveCoachAudio;
    voiceError?: string;
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
    voiceEnabled: true,
    aiCommentary: false,
    entries: true,
    sizing: true,
    exits: true,
    guardrails: true,
    cooldownSeconds: 10,
    speechRate: 1,
    voice: DEFAULT_LIVE_COACH_VOICE,
};
