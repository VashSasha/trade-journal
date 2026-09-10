import { TradovateLivePositionEventKind } from '../integrations/tradovate-live/tradovate-live.models';

export interface LiveCoachPreferences {
    enabled: boolean;
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
}

export const DEFAULT_LIVE_COACH_PREFERENCES: Readonly<LiveCoachPreferences> = {
    enabled: false,
    entries: true,
    sizing: true,
    exits: true,
    guardrails: true,
    cooldownSeconds: 10,
    speechRate: 1,
};
