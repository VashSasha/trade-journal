import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { OpenAiService } from './openai.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';
import { DemoModeService } from './demo-mode.service';

describe('paid AI access and streaming failures', () => {
    const plan = signal('premium');
    let ai: OpenAiService;
    beforeEach(() => {
        const controller = new AbortController();
        TestBed.configureTestingModule({ providers: [
            { provide: AuthService, useValue: { plan, refreshProfile: async () => {} } },
            { provide: SupabaseService, useValue: { client: { auth: { getSession: async () => ({ data: {
                session: { user: { id: 'A' }, access_token: 'test' },
            } }) } } } },
            { provide: UserSessionService, useValue: { capture: () => ({ userId: 'A', signal: controller.signal }), assertCurrent: () => {} } },
            { provide: DemoModeService, useValue: { active: () => false } },
        ] });
        ai = TestBed.inject(OpenAiService);
    });
    afterEach(() => vi.unstubAllGlobals());
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
});
