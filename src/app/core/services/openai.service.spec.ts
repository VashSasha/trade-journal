import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { OpenAiService } from './openai.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';
import { DemoModeService } from './demo-mode.service';
import { cacheSuspended, setCacheSuspended } from './user-data/user-data.cache';

describe('paid AI access and streaming failures', () => {
    const plan = signal('premium');
    let ai: OpenAiService;
    beforeEach(() => {
        plan.set('premium'); setCacheSuspended(false);
        const controller = new AbortController();
        TestBed.configureTestingModule({ providers: [
            { provide: AuthService, useValue: { plan, isAuthenticated: () => true, refreshProfile: async () => {} } },
            { provide: SupabaseService, useValue: { client: { auth: { getSession: async () => ({ data: {
                session: { user: { id: 'A' }, access_token: 'test' },
            } }) } } } },
            { provide: UserSessionService, useValue: { capture: () => ({ userId: 'A', signal: controller.signal }), assertCurrent: () => {} } },
            { provide: DemoModeService, useValue: { active: cacheSuspended } },
        ] });
        ai = TestBed.inject(OpenAiService);
    });
    afterEach(() => { vi.unstubAllGlobals(); setCacheSuspended(false); });
    it('gives premium and lifetime identical access, not free', () => {
        for (const p of ['premium', 'lifetime']) { plan.set(p); expect(ai.hasApiKey()).toBe(true); }
        plan.set('free'); expect(ai.hasApiKey()).toBe(false);
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

    it('does not make an AI request from a free real workspace', async () => {
        plan.set('free');
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
});
