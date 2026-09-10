import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradovateService } from '../../core/services/tradovate.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { AlertCenterService } from '../alerts/alert-center.service';
import { PerformanceAlertsService } from '../alerts/performance-alerts.service';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { LiveCoachNarratorService } from './live-coach-narrator.service';
import { LiveCoachPreferences } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';

const OWNER = '11111111-1111-4111-8111-111111111111';

function positionEvent(overrides: Partial<TradovateLivePositionEvent> = {}): TradovateLivePositionEvent {
    return {
        eventId: 'event-1', connectionId: 'connection-1', accountId: 10, positionId: 20,
        contractId: 30, tradeDate: '2026-09-09', kind: 'opened', direction: 'long',
        previousQuantity: 0, quantity: 1, averagePrice: 23_000, observedAt: 100,
        ...overrides,
    };
}

describe('LiveCoachService', () => {
    const preferences = signal<LiveCoachPreferences>({
        enabled: true, entries: true, sizing: true, exits: true, guardrails: true,
        cooldownSeconds: 10, speechRate: 1,
    });
    const events = signal<readonly TradovateLivePositionEvent[]>([]);
    const performanceEvent = signal<{ id: number; tone: 'target' | 'risk'; text: string } | null>(null);
    const userId = signal<string | null>(OWNER);
    const publish = vi.fn();
    const speak = vi.fn(async () => true);
    const setRequested = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        preferences.set({
            enabled: true, entries: true, sizing: true, exits: true, guardrails: true,
            cooldownSeconds: 10, speechRate: 1,
        });
        events.set([]);
        performanceEvent.set(null);
        userId.set(OWNER);
        publish.mockReset();
        speak.mockClear();
        setRequested.mockReset();

        TestBed.configureTestingModule({ providers: [
            { provide: AccountAlertPreferencesService, useValue: {
                liveCoach: preferences,
                loading: signal(false),
                syncWarning: signal(false),
                storageWarning: signal(false),
                updateLiveCoach: (updater: (value: LiveCoachPreferences) => LiveCoachPreferences) =>
                    preferences.set(updater(preferences())),
            } },
            { provide: TradovateLiveService, useValue: {
                positionEvents: events,
                state: signal('live'),
                statusLabel: computed(() => 'Live'),
                statusDetail: computed(() => 'Broker updates are live.'),
                setRequested,
            } },
            { provide: TradovateService, useValue: {
                getContractForConnection: vi.fn(() => of({ id: 30, name: 'MNQZ6' })),
            } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: AlertCenterService, useValue: { publish } },
            { provide: PerformanceAlertsService, useValue: { event: performanceEvent } },
            { provide: LiveCoachNarratorService, useValue: {
                supported: signal(true), state: signal('idle'), error: signal(null),
                speak, stop: vi.fn(),
            } },
        ] });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        vi.useRealTimers();
    });

    it('requests realtime data and coalesces copied accounts into one spoken observation', async () => {
        const service = TestBed.inject(LiveCoachService);
        TestBed.tick();
        expect(setRequested).toHaveBeenCalledWith('live-coach', true);

        events.set([
            positionEvent(),
            positionEvent({ eventId: 'event-2', accountId: 11, positionId: 21, quantity: 2, observedAt: 110 }),
        ]);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());

        expect(speak).toHaveBeenCalledWith(
            'Opened MNQZ6 long with 3 contracts across 2 accounts.',
            1,
        );
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Position opened',
            text: 'Opened MNQZ6 long with 3 contracts across 2 accounts.',
        }));
        expect(service.lastComment()?.accountCount).toBe(2);
    });

    it('does not replay events collected while coaching is disabled', async () => {
        preferences.update(current => ({ ...current, enabled: false }));
        TestBed.inject(LiveCoachService);
        TestBed.tick();
        events.set([positionEvent()]);
        TestBed.tick();

        preferences.update(current => ({ ...current, enabled: true }));
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(speak).not.toHaveBeenCalled();
    });

    it('speaks an existing performance guardrail after its alert sound', async () => {
        TestBed.inject(LiveCoachService);
        TestBed.tick();

        performanceEvent.set({ id: 1, tone: 'risk', text: 'Daily loss limit reached at $300.' });
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(1_600);

        expect(speak).toHaveBeenCalledWith('Daily loss limit reached at $300.', 1);
    });
});
