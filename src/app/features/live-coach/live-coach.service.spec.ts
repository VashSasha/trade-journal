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
import { SessionAlertsService } from '../alerts/session-alerts.service';
import { PerformanceAlertsService } from '../alerts/performance-alerts.service';
import { TradovateLiveAccountMetric, TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { LiveCoachNarratorService } from './live-coach-narrator.service';
import { LiveCoachAiPayload, LiveCoachPreferences, LiveCoachReply } from './live-coach.models';
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
        enabled: true, voiceEnabled: true, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
        cooldownSeconds: 10, speechRate: 1, voice: 'browser',
    });
    const masterEnabled = signal(true);
    const allowed = signal(true);
    const events = signal<readonly TradovateLivePositionEvent[]>([]);
    const metrics = signal<TradovateLiveAccountMetric[]>([]);
    const performanceEvent = signal<{ id: number; tone: 'target' | 'risk'; text: string } | null>(null);
    const userId = signal<string | null>(OWNER);
    const publish = vi.fn();
    const speak = vi.fn(async () => true);
    const generateLiveCoachReply = vi.fn(async (_payload: unknown, _signal: AbortSignal): Promise<LiveCoachReply> => ({ text: 'Stay selective and keep your size consistent.' }));
    const setRequested = vi.fn();
    const generateLiveCoachSpeech = vi.fn(async (text: string, _voice: string, _signal: AbortSignal): Promise<LiveCoachReply> =>
        ({ text, audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } }));
    const liveState = signal('live');
    const stop = vi.fn();
    const activate = vi.fn(async () => true);
    const previewLiveCoachVoice = vi.fn(async () => ({ text: 'Your AI coach is ready.', audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } }));

    beforeEach(() => {
        vi.useFakeTimers();
        preferences.set({
            enabled: true, voiceEnabled: true, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
            cooldownSeconds: 10, speechRate: 1, voice: 'browser',
        });
        masterEnabled.set(true);
        allowed.set(true);
        events.set([]);
        metrics.set([]);
        performanceEvent.set(null);
        userId.set(OWNER);
        liveState.set('live');
        stop.mockClear();
        previewLiveCoachVoice.mockClear();
        publish.mockReset();
        speak.mockClear();
        generateLiveCoachReply.mockReset();
        generateLiveCoachSpeech.mockClear();
        generateLiveCoachReply.mockResolvedValue({ text: 'Stay selective and keep your size consistent.' });
        setRequested.mockReset();

        TestBed.configureTestingModule({ providers: [
            { provide: SessionAlertsService, useValue: { enabled: masterEnabled } },
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
                metrics,
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
            { provide: OpenAiService, useValue: { generateLiveCoachReply, previewLiveCoachVoice, generateLiveCoachSpeech } },
            { provide: AccessPolicyService, useValue: {
                canAct: () => allowed(),
                requestAction: () => allowed(),
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

    it('retains the original aggregate snapshot and capture time for later follow-ups', async () => {
        vi.setSystemTime(new Date('2026-09-18T15:00:00Z'));
        preferences.update(p => ({ ...p, aiCommentary: true, voiceEnabled: false }));
        metrics.set([{ connectionId: 'connection-1', accountId: 10, tradeDate: '2026-09-18', dailyPnl: 200, weeklyPnl: 800,
            balance: 25_200, completedTrades: 2, baselineKey: 'test', updatedAt: Date.now() }]);
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent({ tradeDate: '2026-09-18' })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        const captured = generateLiveCoachReply.mock.calls[0][0] as LiveCoachAiPayload;
        expect(captured.session.dailyPnl).toBe(200);
        metrics.update(items => items.map(item => ({ ...item, dailyPnl: 500, weeklyPnl: 1100 }))); TestBed.tick();
        await vi.advanceTimersByTimeAsync(2000);
        resolve({ text: 'One contract opened.' }); await vi.advanceTimersByTimeAsync(1);
        const comment = service.recentComments()[0];
        expect(comment.snapshot?.session.dailyPnl).toBe(200);
        expect(comment.snapshot?.session.weeklyPnl).toBe(800);
        expect(comment.time).toBeLessThan(Date.now() - 1500);
        // Stored context is independent of the object passed to the AI adapter.
        captured.session.dailyPnl = -999;
        expect(comment.snapshot?.session.dailyPnl).toBe(200);
        expect(comment.snapshot).not.toBe(captured);
    });
    it('preserves preferences and writes guardrails while master-muted, without replaying audio', async () => {
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        const saved = preferences();
        masterEnabled.set(false); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        performanceEvent.set({ id: 1, tone: 'risk', text: 'Loss limit reached.' }); TestBed.tick();
        await service.preview();
        await vi.advanceTimersByTimeAsync(2000);
        expect(speak).not.toHaveBeenCalled();
        expect(previewLiveCoachVoice).not.toHaveBeenCalled();
        expect(service.recentComments()[0].text).toBe('Loss limit reached.');
        masterEnabled.set(true); TestBed.tick();
        await vi.advanceTimersByTimeAsync(2000);
        expect(speak).not.toHaveBeenCalled();
        expect(preferences()).toBe(saved);
        events.set([positionEvent({ eventId: 'fresh-event' })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        expect(speak).toHaveBeenCalledOnce();
    });
    it('keeps pending AI text on master mute but never speaks its late audio after unmute', async () => {
        preferences.update(p => ({ ...p, aiCommentary: true }));
        let resolve!: (value: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(900);
        const requestSignal = generateLiveCoachReply.mock.calls[0][1] as AbortSignal;
        masterEnabled.set(false); TestBed.tick();
        expect(requestSignal.aborted).toBe(false);
        masterEnabled.set(true); TestBed.tick();
        resolve({ text: 'Current written observation.', audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } });
        await vi.advanceTimersByTimeAsync(1000);
        expect(speak).not.toHaveBeenCalled();
        expect(service.recentComments()[0].text).toBe('Current written observation.');
    });

    it('keeps factual position updates without any speech request while coach-only muted', async () => {
        preferences.update(p => ({ ...p, voice: 'cedar', voiceEnabled: false }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(service.recentComments()[0].text).toContain('Opened MNQZ6');
        expect(generateLiveCoachSpeech).not.toHaveBeenCalled();
        expect(speak).not.toHaveBeenCalled();
        expect(masterEnabled()).toBe(true);
    });

    it('does not speak events received while muted even if unmuted before grouping finishes', async () => {
        masterEnabled.set(false);
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        masterEnabled.set(true); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(service.recentComments()).toHaveLength(1);
        expect(speak).not.toHaveBeenCalled();
    });

    it('shows a warning and uses browser voice when voice-only generation times out', async () => {
        preferences.update(p => ({ ...p, voice: 'cedar' }));
        generateLiveCoachSpeech.mockReturnValueOnce(new Promise(() => {}));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(31_000);
        expect(service.voiceWarning()).toContain('Using browser voice');
        expect(speak).toHaveBeenCalledOnce();
        expect(service.recentComments()).toHaveLength(1);
    });

    it('requests only AI text while muted and does not generate delayed speech on unmute', async () => {
        preferences.update(p => ({ ...p, voice: 'cedar', aiCommentary: true, voiceEnabled: false }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachReply.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick(); await vi.advanceTimersByTimeAsync(900);
        expect(generateLiveCoachReply).toHaveBeenCalledWith(expect.objectContaining({ voice: 'browser' }), expect.any(AbortSignal));
        service.setVoiceEnabled(true); TestBed.tick();
        resolve({ text: 'Keep your size consistent.' });
        await vi.advanceTimersByTimeAsync(1000);
        expect(service.recentComments()[0].personalized).toBe(true);
        expect(speak).not.toHaveBeenCalled();
        expect(generateLiveCoachSpeech).not.toHaveBeenCalled();
    });

    it('aborts voice-only generation immediately on mute without removing the observation', async () => {
        preferences.update(p => ({ ...p, voice: 'cedar' }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachSpeech.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick(); await vi.advanceTimersByTimeAsync(900);
        const request = generateLiveCoachSpeech.mock.calls[0][2];
        service.setVoiceEnabled(false); TestBed.tick();
        expect(request.aborted).toBe(true);
        service.setVoiceEnabled(true); TestBed.tick();
        resolve({ text: 'Old audio', audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } });
        await vi.advanceTimersByTimeAsync(1000);
        expect(speak).not.toHaveBeenCalled();
        expect(service.recentComments()).toHaveLength(1);
    });

    it('clears private history and stops monitoring when access is lost or entering demo', async () => {
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        expect(service.recentComments()).toHaveLength(1);
        allowed.set(false); TestBed.tick();
        expect(service.recentComments()).toEqual([]);
        expect(setRequested).toHaveBeenLastCalledWith('live-coach', false);
        events.set([positionEvent({ eventId: 'denied' })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(service.recentComments()).toEqual([]);
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
        await vi.advanceTimersByTimeAsync(30_900);
        expect(service.aiState()).toBe('fallback');
        expect(speak).toHaveBeenCalledWith('Opened MNQZ6 long with 1 contract.', 1);
    });

    it('uses the selected AI voice for sizing without needing personalized commentary', async () => {
        preferences.update(value => ({ ...value, voice: 'cedar' }));
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent({ kind: 'increased', previousQuantity: 1, quantity: 2 })]); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(generateLiveCoachReply).not.toHaveBeenCalled();
        expect(generateLiveCoachSpeech).toHaveBeenCalledWith(expect.any(String), 'cedar', expect.any(AbortSignal));
        expect(speak).toHaveBeenCalledWith(expect.any(String), 1, { mimeType: 'audio/mpeg', base64: 'YWJj' });
    });

    it('uses the selected voice for guardrails and makes provider failures visible', async () => {
        preferences.update(value => ({ ...value, voice: 'marin' }));
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        performanceEvent.set({ id: 1, tone: 'target', text: 'Daily target touched at $500.' }); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1700);
        expect(generateLiveCoachSpeech).toHaveBeenCalledWith('Daily target touched at $500.', 'marin', expect.any(AbortSignal));
        generateLiveCoachSpeech.mockRejectedValueOnce(new Error('Live Coach AI daily limit reached (30 comments).'));
        performanceEvent.set({ id: 2, tone: 'risk', text: 'Daily loss limit reached.' }); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1700);
        expect(service.voiceWarning()).toContain('daily limit');
        expect(speak).toHaveBeenLastCalledWith('Daily loss limit reached.', 1);
    });

    it('discards delayed voice-only audio when the position changes or the user logs out', async () => {
        preferences.update(value => ({ ...value, voice: 'cedar', exits: false }));
        let resolve!: (reply: LiveCoachReply) => void;
        generateLiveCoachSpeech.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        TestBed.inject(LiveCoachService); TestBed.tick();
        events.set([positionEvent()]); TestBed.tick(); await vi.advanceTimersByTimeAsync(1000);
        events.set([positionEvent({ eventId: 'closed', kind: 'closed', previousQuantity: 1, quantity: 0 })]); TestBed.tick();
        userId.set(null); TestBed.tick();
        resolve({ text: 'Old position.', audio: { mimeType: 'audio/mpeg', base64: 'YWJj' } });
        await vi.advanceTimersByTimeAsync(1000);
        expect(speak).not.toHaveBeenCalled();
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
        masterEnabled.update(value => !value); TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        masterEnabled.update(value => !value); TestBed.tick();
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

    it('selects and previews an additional AI voice while rejecting unknown values', async () => {
        const service = TestBed.inject(LiveCoachService); TestBed.tick();
        service.setVoice('coral'); TestBed.tick();
        expect(preferences().voice).toBe('coral');
        service.setVoice('untrusted_voice');
        expect(preferences().voice).toBe('coral');
        await service.preview();
        expect(previewLiveCoachVoice).toHaveBeenCalledExactlyOnceWith('coral', expect.any(AbortSignal));
    });
});
