import { describe, expect, it } from 'vitest';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import {
    buildLiveCoachNarration,
    liveCoachEventBucket,
    parseLiveCoachPreferences,
} from './live-coach.utils';

function event(overrides: Partial<TradovateLivePositionEvent> = {}): TradovateLivePositionEvent {
    return {
        eventId: 'event-1', connectionId: 'connection-1', accountId: 10, positionId: 20,
        contractId: 30, tradeDate: '2026-09-09', kind: 'opened', direction: 'long',
        previousQuantity: 0, quantity: 1, averagePrice: 23_000, observedAt: 100,
        ...overrides,
    };
}

describe('live coach utilities', () => {
    it('normalizes account-synced preferences into safe limits', () => {
        expect(parseLiveCoachPreferences(JSON.stringify({
            enabled: true, entries: false, sizing: true, exits: false, guardrails: false,
            cooldownSeconds: 999, speechRate: 0.1,
        }))).toEqual({
            enabled: true, entries: false, sizing: true, exits: false, guardrails: false,
            cooldownSeconds: 60, speechRate: 0.8,
        });
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
});
