import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { OpenAiService } from './openai.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';
import { DemoModeService } from './demo-mode.service';
import { cacheSuspended, setCacheSuspended } from './user-data/user-data.cache';
import { AiCoachingSettingsService } from '../../features/ai-settings/ai-coaching-settings.service';

describe('paid AI access and streaming failures', () => {
    const plan = signal('premium_plus');
    const coachingMode = signal('standard');
    const saving = signal(false);
    let toneController: AbortController;
    const invoke = vi.fn(async () => ({ data: { text: 'Stay selective.' }, error: null }));
    let ai: OpenAiService;
    beforeEach(() => {
        plan.set('premium_plus'); setCacheSuspended(false);
        coachingMode.set('standard'); saving.set(false); toneController = new AbortController();
        invoke.mockClear();
        const controller = new AbortController();
        TestBed.configureTestingModule({ providers: [
            { provide: AiCoachingSettingsService, useValue: { mode: coachingMode, saving, load: async () => {}, get requestSignal() { return toneController.signal; } } },
            { provide: AuthService, useValue: { plan, aiAccess: computed(() => plan() === 'premium_plus'), isAuthenticated: () => true, refreshProfile: async () => {} } },
            { provide: SupabaseService, useValue: { client: { auth: { getSession: async () => ({ data: {
                session: { user: { id: 'A' }, access_token: 'test' },
            } }) }, functions: { invoke } } } },
            { provide: UserSessionService, useValue: { capture: () => ({ userId: 'A', signal: controller.signal }), assertCurrent: () => {} } },
            { provide: DemoModeService, useValue: { active: cacheSuspended } },
        ] });
        ai = TestBed.inject(OpenAiService);
    });
    afterEach(() => { vi.unstubAllGlobals(); setCacheSuspended(false); });
    it('includes AI only when the server grants the capability', () => {
        plan.set('premium_plus'); expect(ai.hasApiKey()).toBe(true);
        for (const p of ['free', 'premium', 'lifetime']) { plan.set(p); expect(ai.hasApiKey()).toBe(false); }
    });
    it('surfaces server stream errors instead of completing an incomplete report', async () => {
        vi.stubGlobal('fetch', async () => new Response('data: {"type":"error","error":"Analysis interrupted"}\n\n'));
        await expect(lastValueFrom(ai.streamAnalysis([]))).rejects.toThrow('Analysis interrupted');
    });
    it('treats EOF without a completion marker as a failure', async () => {
        vi.stubGlobal('fetch', async () => new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Partial"}}\n\n'));
        await expect(lastValueFrom(ai.streamAnalysis([]))).rejects.toThrow('ended unexpectedly');
    });
    it('completes normally only with an explicit message_stop', async () => {
        vi.stubGlobal('fetch', async () => new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Result"}}\n\ndata: {"type":"message_stop"}\n\n'));
        expect(await lastValueFrom(ai.streamAnalysis([]))).toBe('Result');
    });

    it.each(['free', 'premium', 'lifetime'])('does not make an AI request from a %s real workspace', async tier => {
        plan.set(tier);
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await expect(lastValueFrom(ai.streamAnalysis([]))).rejects.toThrow('Upgrade');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('returns a labelled example for buffered demo requests without calling the backend', async () => {
        plan.set('free'); setCacheSuspended(true);
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        expect(await lastValueFrom(ai.analyzeTrade([], {}))).toContain('Example only');
        expect(fetch).not.toHaveBeenCalled();
        expect(ai.hasApiKey()).toBe(true); // The preview is available without a paid subscription.
    });

    it('sends Live Coach context through the authenticated AI proxy', async () => {
        const signal = new AbortController().signal;
        await expect(ai.generateLiveCoachComment({ observation: {}, session: {} }, signal))
            .resolves.toBe('Stay selective.');
        expect(invoke).toHaveBeenCalledWith('ai-report', expect.objectContaining({
            body: { type: 'live-coach', payload: { observation: {}, session: {} }, coachingMode: 'standard' },
            headers: { Authorization: 'Bearer test' },
            signal: expect.any(AbortSignal),
        }));
    });

    it('retains voice audio in Coach replies and rejects requests aborted during auth', async () => {
        const audio = { mimeType: 'audio/mpeg' as const, base64: 'YWJj' };
        invoke.mockResolvedValueOnce({ data: { text: 'Stay selective.', audio } as any, error: null });
        await expect(ai.generateLiveCoachReply({ voice: 'marin' })).resolves.toEqual({ text: 'Stay selective.', audio });
        invoke.mockClear();
        const controller = new AbortController(); controller.abort();
        await expect(ai.previewLiveCoachVoice('cedar', controller.signal)).rejects.toThrow();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('sends only a saved observation reference for chat replies, not client-supplied observation content', async () => {
        const followUp = { meaning: 'Your size increased.', evidence: 'Captured position.', nextStep: 'Review your sizing plan.' };
        invoke.mockResolvedValueOnce({ data: { followUp } as any, error: null });
        await expect(ai.askCoach({ conversationId: 'chat', turnId: 'turn', message: 'What changed?', context: {
            capturedAt: '2026-09-28T15:00:00Z', tradeDate: '2026-09-28', accountIds: null, dataReady: false, summary: null,
            replyTo: { id: 'original', observedAt: '2026-09-28T14:00:00Z', title: 'Position increased', text: 'Local text', snapshot: null },
        } })).resolves.toEqual(followUp);
        expect(invoke).toHaveBeenCalledWith('ai-report', expect.objectContaining({ body: {
            type: 'live-coach-chat', payload: expect.objectContaining({ context: expect.objectContaining({ replyTo: { id: 'original' } }) }), coachingMode: 'standard',
        } }));
    });

    it('authenticates written follow-ups and validates their structured response', async () => {
        const payload = { question: 'explain' as const, observedAt: '2026-09-18T15:00:00.000Z',
            comment: 'Daily target touched including estimated open profit.', snapshot: null };
        const followUp = { meaning: 'The estimate touched the target.', evidence: 'Open profit was included.',
            nextStep: 'Review your recorded plan.' };
        invoke.mockResolvedValueOnce({ data: { followUp } as any, error: null });
        await expect(ai.generateLiveCoachFollowUp(payload)).resolves.toEqual(followUp);
        expect(invoke).toHaveBeenCalledWith('ai-report', expect.objectContaining({
            body: { type: 'live-coach-follow-up', payload, coachingMode: 'standard' }, headers: { Authorization: 'Bearer test' },
        }));
        invoke.mockResolvedValueOnce({ data: { followUp: { meaning: 'Partial' } } as any, error: null });
        await expect(ai.generateLiveCoachFollowUp(payload)).rejects.toThrow('incomplete answer');
    });

    it('never requests written follow-ups from free or demo workspaces', async () => {
        const payload = { question: 'explain' as const, observedAt: '2026-09-18T15:00:00.000Z', comment: 'Opened one contract.', snapshot: null };
        plan.set('free');
        await expect(ai.generateLiveCoachFollowUp(payload)).rejects.toThrow('Upgrade');
        plan.set('premium_plus'); setCacheSuspended(true);
        await expect(ai.generateLiveCoachFollowUp(payload)).rejects.toThrow('demo mode');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('passes the confirmed tone on buffered and streaming AI requests', async () => {
        coachingMode.set('unhinged');
        await ai.generateLiveCoachReply({ observation: {}, session: {} });
        expect(invoke.mock.calls[0]).toEqual(['ai-report', expect.objectContaining({ body: expect.objectContaining({ coachingMode: 'unhinged' }) })]);
        const fetch = vi.fn(async () => new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Review"}}\n\ndata: {"type":"message_stop"}\n\n'));
        vi.stubGlobal('fetch', fetch);
        await lastValueFrom(ai.streamAnalysis([]));
        expect(JSON.parse((fetch.mock.calls[0] as any)[1].body).coachingMode).toBe('unhinged');
    });

    it('blocks new generation while consent is saving and cancels a stream on tone change', async () => {
        saving.set(true);
        await expect(ai.generateLiveCoachReply({})).rejects.toThrow('preference is saving');
        expect(invoke).not.toHaveBeenCalled();
        saving.set(false);
        const fetch = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
        vi.stubGlobal('fetch', fetch);
        const result = lastValueFrom(ai.streamAnalysis([]));
        const rejected = expect(result).rejects.toThrow('preferences changed');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        toneController.abort();
        await rejected;
    });
});
