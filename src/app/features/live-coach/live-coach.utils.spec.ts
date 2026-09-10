import { describe, expect, it } from 'vitest';
import { Trade } from '../../core/models/trade.model';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { LIVE_COACH_AI_VOICES, LIVE_COACH_AI_VOICE_OPTIONS } from './live-coach-voices';
import {
    buildLiveCoachAiPayload,
    buildLiveCoachNarration,
    liveCoachEventBucket,
    normalizeLiveCoachAiText,
    parseLiveCoachPreferences,
    shouldPersonalizeLiveCoachEvent,
} from './live-coach.utils';

function event(overrides: Partial<TradovateLivePositionEvent> = {}): TradovateLivePositionEvent {
    return {
        eventId: 'event-1', connectionId: 'connection-1', accountId: 10, positionId: 20,
        contractId: 30, tradeDate: '2026-09-09', kind: 'opened', direction: 'long',
        previousQuantity: 0, quantity: 1, averagePrice: 23_000, observedAt: 100,
        ...overrides,
    };
}

function trade(id: string, accountId: string, entryTime: string, pnl: number): Trade {
    return {
        id, userId: 'owner', symbol: 'MNQ', assetType: 'futures', direction: 'long',
        entryDate: '2026-09-09', entryTime, entryPrice: 23_000, quantity: 1,
        exitDate: '2026-09-09', exitTime: entryTime, exitPrice: 23_001,
        pnl, netPnl: pnl, accountId, status: 'closed',
        createdAt: '2026-09-09T12:00:00', updatedAt: '2026-09-09T12:00:00',
    };
}

describe('live coach utilities', () => {
    it('normalizes account-synced preferences into safe limits', () => {
        expect(parseLiveCoachPreferences(JSON.stringify({
            enabled: true, aiCommentary: true, entries: false, sizing: true, exits: false, guardrails: false,
            cooldownSeconds: 999, speechRate: 0.1,
        }))).toEqual({
            enabled: true, aiCommentary: true, entries: false, sizing: true, exits: false, guardrails: false,
            cooldownSeconds: 60, speechRate: 0.8, voice: 'cedar',
        });
    });

    it('defaults unconfigured or invalid voices to Cedar without opting users into coaching', () => {
        for (const raw of [null, '{}', '{', JSON.stringify({ voice: 'unknown' })]) {
            expect(parseLiveCoachPreferences(raw)).toEqual(expect.objectContaining({
                enabled: false, aiCommentary: false, voice: 'cedar',
            }));
        }
        expect(LIVE_COACH_AI_VOICE_OPTIONS[0]).toEqual({ id: 'cedar', label: 'Cedar · Default' });
    });

    it('preserves every supported saved voice, including an explicit browser selection', () => {
        for (const voice of ['browser', ...LIVE_COACH_AI_VOICES]) {
            expect(parseLiveCoachPreferences(JSON.stringify({ voice })).voice).toBe(voice);
        }
    });

    it('coalesces copied openings into one account-aware narration', () => {
        const narration = buildLiveCoachNarration([
            event(),
            event({ eventId: 'event-2', accountId: 11, positionId: 21, quantity: 2, observedAt: 110 }),
            event({ eventId: 'event-3', accountId: 10, kind: 'increased', previousQuantity: 1, quantity: 3, observedAt: 120 }),
        ], 'MNQZ6');

        expect(narration).toEqual(expect.objectContaining({
            kind: 'opened', accountCount: 2, previousQuantity: 0, quantity: 5,
            text: 'Opened MNQZ6 long with 5 contracts across 2 accounts.',
        }));
    });

    it('describes closes and reversals without counting accounts as trades', () => {
        expect(buildLiveCoachNarration([
            event({ kind: 'closed', previousQuantity: 2, quantity: 0 }),
            event({ eventId: 'event-2', accountId: 11, positionId: 21, kind: 'closed', previousQuantity: 2, quantity: 0 }),
        ], 'NQZ6')?.text).toBe('Closed NQZ6 long: 4 contracts across 2 accounts.');

        expect(buildLiveCoachNarration([
            event({ kind: 'reversed', direction: 'short', previousQuantity: 2, quantity: 1 }),
        ], 'ESZ6')).toEqual(expect.objectContaining({
            tone: 'warning', text: 'ESZ6 reversed short with 1 contract.',
        }));
    });

    it('buckets scale-ins together but keeps exits separate', () => {
        expect(liveCoachEventBucket(event({ kind: 'opened' })))
            .toBe(liveCoachEventBucket(event({ kind: 'increased' })));
        expect(liveCoachEventBucket(event({ kind: 'closed' })))
            .not.toBe(liveCoachEventBucket(event({ kind: 'increased' })));
    });

    it('builds identity-free context using decisions instead of copied executions', () => {
        const events = [
            event({ accountId: 10, quantity: 1 }),
            event({ eventId: 'event-2', accountId: 11, positionId: 21, quantity: 1 }),
        ];
        const narration = buildLiveCoachNarration(events, 'MNQZ6')!;
        const payload = buildLiveCoachAiPayload(events, narration, [
            trade('a1', '10', '09:30:00', -10),
            trade('a2', '11', '09:30:00', -10),
            trade('b1', '10', '10:00:00', 20),
            trade('b2', '11', '10:00:00', 20),
        ], [], 'MNQZ6', new Date('2026-09-09T12:00:00'));

        expect(payload.observation).toEqual(expect.objectContaining({ accountCount: 2, quantity: 2 }));
        expect(payload.session).toEqual(expect.objectContaining({
            executionCount: 4,
            decisionCount: 2,
            accountCount: 2,
            winRate: 50,
            recentDecisionPnls: [-20, 40],
            typicalContractsPerAccount: 1,
            currentContractsPerAccount: 1,
        }));
        expect(JSON.stringify(payload)).not.toContain('owner');
        expect(JSON.stringify(payload)).not.toContain('accountId');
    });

    it('limits personalization to lifecycle moments and normalizes spoken output', () => {
        expect(shouldPersonalizeLiveCoachEvent('opened')).toBe(true);
        expect(shouldPersonalizeLiveCoachEvent('increased')).toBe(false);
        expect(normalizeLiveCoachAiText('**Keep size consistent.**\n')).toBe('Keep size consistent.');
        expect(normalizeLiveCoachAiText('Buy another contract now.')).toBeNull();
    });
});
