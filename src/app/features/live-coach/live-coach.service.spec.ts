import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { TradeService } from '../../core/services/trade.service';
import { TradovateService } from '../../core/services/tradovate.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { AlertCenterService } from '../alerts/alert-center.service';
import { PerformanceAlertsService } from '../alerts/performance-alerts.service';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { LiveCoachNarratorService } from './live-coach-narrator.service';
import { LiveCoachPreferences, LiveCoachReply } from './live-coach.models';
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
        enabled: true, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
        cooldownSeconds: 10, speechRate: 1, voice: 'browser',
    });
    const events = signal<readonly TradovateLivePositionEvent[]>([]);
    const performanceEvent = signal<{ id: number; tone: 'target' | 'risk'; text: string } | null>(null);
    const userId = signal<string | null>(OWNER);
    const publish = vi.fn();
    const speak = vi.fn(async () => true);
    const generateLiveCoachReply = vi.fn(async (): Promise<LiveCoachReply> => ({ text: 'Stay selective and keep your size consistent.' }));
    const setRequested = vi.fn();
    const liveState = signal('live');
    const stop = vi.fn();
    const activate = vi.fn(async () => true);
    const previewLiveCoachVoice = vi.fn(async () => ({ text: 'Your AI coach is ready.', audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } }));

    beforeEach(() => {
        vi.useFakeTimers();
        preferences.set({
            enabled: true, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
            cooldownSeconds: 10, speechRate: 1, voice: 'browser',
        });
        events.set([]);
        performanceEvent.set(null);
        userId.set(OWNER);
        liveState.set('live');
        stop.mockClear();
        previewLiveCoachVoice.mockClear();
        publish.mockReset();
        speak.mockClear();
        generateLiveCoachReply.mockReset();
        generateLiveCoachReply.mockResolvedValue({ text: 'Stay selective and keep your size consistent.' });
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
                metrics: signal([]),
                state: liveState,
                statusLabel: computed(() => 'Live'),
                statusDetail: computed(() => 'Broker updates are live.'),
                setRequested,
            } },
            { provide: TradovateService, useValue: {
                getContractForConnection: vi.fn(() => of({ id: 30, name: 'MNQZ6' })),
            } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: TradeService, useValue: { trades: signal([]) } },
            { provide: OpenAiService, useValue: { generateLiveCoachReply, previewLiveCoachVoice } },
            { provide: AccessPolicyService, useValue: {
                canAct: () => true,
                requestAction: () => true,
            } },
            { provide: AlertCenterService, useValue: { publish } },
            { provide: PerformanceAlertsService, useValue: { event: performanceEvent } },
            { provide: LiveCoachNarratorService, useValue: {
                supported: signal(true), state: signal('idle'), error: signal(null),
                speak, stop, activate, audioReady: signal(true), voiceFallback: signal(false),
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

    it('personalizes a grouped entry with decision-aware aggregate context', async () => {
        preferences.update(current => ({ ...current, aiCommentary: true }));
        const service = TestBed.inject(LiveCoachService);
        TestBed.tick();
        events.set([
            positionEvent(),
            positionEvent({ eventId: 'event-2', accountId: 11, positionId: 21, quantity: 2, observedAt: 110 }),
        ]);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());

        expect(generateLiveCoachReply).toHaveBeenCalledWith(expect.objectContaining({
            observation: expect.objectContaining({ symbol: 'MNQZ6', quantity: 3, accountCount: 2 }),
            session: expect.objectContaining({ executionCount: 0, decisionCount: 0, currentContractsPerAccount: 1.5 }),
        }), expect.any(AbortSignal));
        expect(speak).toHaveBeenCalledWith('Stay selective and keep your size consistent.', 1);
        expect(service.lastComment()?.personalized).toBe(true);
        expect(service.aiState()).toBe('ready');
    });

    it('keeps factual narration when personalization is unavailable', async () => {
        preferences.update(current => ({ ...current, aiCommentary: true }));
        generateLiveCoachReply.mockRejectedValueOnce(new Error('offline'));
        const service = TestBed.inject(LiveCoachService);
        TestBed.tick();
        events.set([positionEvent()]);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());

        expect(speak).toHaveBeenCalledWith('Opened MNQZ6 long with 1 contract.', 1);
        expect(service.lastComment()?.personalized).toBe(false);
        expect(service.aiState()).toBe('fallback');
    });

    it('plays AI audio and sends the selected voice with the bounded context', async () => {
        const audio = { mimeType: 'audio/mpeg' as const, base64: 'YWJj' };
        preferences.update(value => ({ ...value, aiCommentary: true, voice: 'marin' }));
        generateLiveCoachReply.mockResolvedValueOnce({ text: 'Stay selective.', audio });
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        expect(generateLiveCoachReply).toHaveBeenCalledWith(expect.objectContaining({ voice: 'marin' }), expect.any(AbortSignal));
        expect(speak).toHaveBeenCalledWith('Stay selective.', 1, audio);
    });

    it('drops an old AI entry response after a newer position close', async () => {
        preferences.update(value => ({ ...value, aiCommentary: true }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        events.set([positionEvent({ eventId: 'closed', kind: 'closed', previousQuantity: 1, quantity: 0 })]);
        TestBed.tick();
        resolve({ text: 'Old entry observation.' });
        await vi.advanceTimersByTimeAsync(900);
        expect(speak).toHaveBeenCalledOnce();
        expect(speak).not.toHaveBeenCalledWith('Old entry observation.', 1);
    });

    it('settles a stalled AI request with factual fallback by the deadline', async () => {
        preferences.update(value => ({ ...value, aiCommentary: true }));
        generateLiveCoachReply.mockReturnValueOnce(new Promise(() => {}));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(12_900);
        expect(service.aiState()).toBe('fallback');
        expect(speak).toHaveBeenCalledWith('Opened MNQZ6 long with 1 contract.', 1);
    });

    it('drops an outdated entry even when exit narration is muted', async () => {
        preferences.update(value => ({ ...value, aiCommentary: true, exits: false }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        events.set([positionEvent({ eventId: 'closed', kind: 'closed', previousQuantity: 1, quantity: 0 })]);
        TestBed.tick();
        resolve({ text: 'An outdated entry.' });
        await vi.advanceTimersByTimeAsync(1500);
        expect(speak).not.toHaveBeenCalled();
    });

    it('resumes position narration when a pending guardrail is disabled remotely', async () => {
        TestBed.inject(LiveCoachService); TestBed.tick();
        performanceEvent.set({ id: 1, tone: 'risk', text: 'Loss limit reached.' }); TestBed.tick();
        preferences.update(value => ({ ...value, guardrails: false })); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(2000);
        expect(speak).toHaveBeenCalledExactlyOnceWith('Opened MNQZ6 long with 1 contract.', 1);
    });

    it('stops on pause, remote disable, and logout without replaying buffered trades', async () => {
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        service.togglePause(); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        service.togglePause(); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(speak).not.toHaveBeenCalled();
        preferences.update(value => ({ ...value, enabled: false })); TestBed.tick();
        expect(stop).toHaveBeenCalled();
        userId.set(null); TestBed.tick();
        expect(service.recentComments()).toEqual([]);
    });

    it('does not voice guardrails in a follower tab', async () => {
        liveState.set('standby');
        TestBed.inject(LiveCoachService); TestBed.tick();
        performanceEvent.set({ id: 1, tone: 'risk', text: 'Loss limit reached.' }); TestBed.tick();
        await vi.advanceTimersByTimeAsync(2000);
        expect(speak).not.toHaveBeenCalled();
    });

    it('gives a guardrail priority over delayed AI copy and rapid scale-ins', async () => {
        preferences.update(value => ({ ...value, aiCommentary: true }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        performanceEvent.set({ id: 1, tone: 'risk', text: 'Daily loss limit reached.' }); TestBed.tick();
        resolve({ text: 'A delayed entry.' });
        events.set([positionEvent({ eventId: 'scaled', kind: 'increased', previousQuantity: 1, quantity: 3 })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(2000);
        expect(speak).toHaveBeenCalledExactlyOnceWith('Daily loss limit reached.', 1);
    });

    it('tests the selected AI voice and prevents repeated preview requests', async () => {
        preferences.update(value => ({ ...value, voice: 'cedar' }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        const preview = service.preview();
        await service.preview();
        await preview;
        expect(activate).toHaveBeenCalled();
        expect(previewLiveCoachVoice).toHaveBeenCalledExactlyOnceWith('cedar', expect.any(AbortSignal));
        expect(service.previewing()).toBe(false);
    });
});
