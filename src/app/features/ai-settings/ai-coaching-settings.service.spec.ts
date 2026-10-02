import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AiCoachingSettingsService } from './ai-coaching-settings.service';
import { hasCoachingConsent } from './ai-coaching-settings.model';

const consent = { unhinged: true, consent_version: 1, consented_at: '2026-09-30T10:00:00Z' };
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve }; };

describe('account-wide AI tone preferences', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(data: unknown = null) {
        const userId = signal<string | null>('A'), demo = signal(false), ai = signal(true);
        const capture = () => ({ userId: userId()!, signal: new AbortController().signal });
        const read = vi.fn().mockResolvedValue({ data, error: null });
        const write = vi.fn().mockResolvedValue({ data: consent, error: null });
        const eq = vi.fn();
        const chain: any = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; },
            abortSignal: () => chain, maybeSingle: read };
        const from = vi.fn(() => chain);
        const rpc = vi.fn((...args: unknown[]) => ({ abortSignal: () => write(...args) }));
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client: { from, rpc } } },
            { provide: UserSessionService, useValue: { userId, isCurrent: (s: any) => s.userId === userId() && !s.signal.aborted } },
            { provide: AccessPolicyService, useValue: { demo, canAct: () => ai() && !demo(), capture } },
        ] });
        const service = TestBed.inject(AiCoachingSettingsService); TestBed.tick();
        return { service, userId, demo, ai, read, write, eq, from, rpc };
    }

    it('defaults off, coalesces loading, scopes the read and caches until refresh', async () => {
        const { service, read, eq } = setup(consent);
        expect(service.active()).toBe(false); expect(read).not.toHaveBeenCalled();
        await Promise.all([service.load(), service.load()]);
        expect(read).toHaveBeenCalledOnce(); expect(eq).toHaveBeenCalledWith('user_id', 'A');
        expect(service.mode()).toBe('unhinged');
        await service.load(); expect(read).toHaveBeenCalledOnce();
        await service.load(true); expect(read).toHaveBeenCalledTimes(2);
    });

    it('requires explicit consent and a confirmed server write before enabling', async () => {
        const { service, rpc, write } = setup(); await service.load();
        expect(await service.setUnhinged(true)).toBe(false); expect(rpc).not.toHaveBeenCalled();
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        const signal = service.requestSignal, saving = service.setUnhinged(true, true);
        expect(signal.aborted).toBe(true); expect(service.active()).toBe(false); expect(service.saving()).toBe(true);
        expect(await service.setUnhinged(true, true)).toBe(false); expect(rpc).toHaveBeenCalledOnce();
        pending.resolve({ data: consent, error: null }); expect(await saving).toBe(true);
        expect(service.active()).toBe(true); expect(service.saving()).toBe(false);
        expect(rpc).toHaveBeenCalledWith('set_my_ai_coaching_mode', { p_unhinged: true, p_accept_terms: true });
    });

    it('does not invent consent after a failed or malformed save and can recover by reloading', async () => {
        const { service, write, read } = setup(); await service.load();
        write.mockResolvedValueOnce({ data: { unhinged: true }, error: null });
        expect(await service.setUnhinged(true, true)).toBe(false);
        expect(service.active()).toBe(false); expect(service.ready()).toBe(false); expect(service.error()).toContain('confirm');
        read.mockResolvedValueOnce({ data: consent, error: null }); await service.load(true);
        expect(service.active()).toBe(true);
        write.mockRejectedValueOnce(new Error('offline'));
        expect(await service.setUnhinged(false)).toBe(false); expect(service.active()).toBe(false);
    });

    it('permits disabling after an AI downgrade but never enabling without AI', async () => {
        const { service, ai, write, rpc } = setup(consent); await service.load();
        ai.set(false); expect(service.enabled()).toBe(true); expect(service.active()).toBe(false);
        write.mockResolvedValueOnce({ data: { ...consent, unhinged: false }, error: null });
        expect(await service.setUnhinged(false)).toBe(true);
        expect(await service.setUnhinged(true, true)).toBe(false); expect(rpc).toHaveBeenCalledOnce();
    });

    it('ignores late reads after an owner switch and never imports consent into demo', async () => {
        const { service, userId, demo, read, eq } = setup();
        const old = deferred(); read.mockReturnValueOnce(old.promise);
        const initial = service.load();
        userId.set('B'); TestBed.tick(); await service.load();
        old.resolve({ data: consent, error: null }); await initial;
        expect(eq).toHaveBeenLastCalledWith('user_id', 'B'); expect(service.active()).toBe(false); expect(service.ready()).toBe(true);
        demo.set(true); TestBed.tick(); read.mockClear(); await service.load();
        expect(read).not.toHaveBeenCalled(); expect(service.ready()).toBe(false);
        demo.set(false); TestBed.tick(); await service.load(); expect(read).toHaveBeenCalledOnce();
    });

    it('does not apply a late enable acknowledgement to another owner', async () => {
        const { service, userId, write } = setup(); await service.load();
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        const saving = service.setUnhinged(true, true);
        userId.set('B'); TestBed.tick(); await service.load();
        pending.resolve({ data: consent, error: null }); expect(await saving).toBe(false);
        expect(service.enabled()).toBe(false); expect(service.saving()).toBe(false);
    });

    it('fails safely on reads and refreshes from the database after another tab changes mode', async () => {
        const { service, read } = setup(consent); await service.load();
        const signal = service.requestSignal;
        read.mockResolvedValueOnce({ data: { ...consent, unhinged: false }, error: null });
        window.dispatchEvent(new StorageEvent('storage', { key: 'nvzn_ai_coaching_changed:A', newValue: 'nonce' }));
        await service.load(); expect(signal.aborted).toBe(true); expect(service.active()).toBe(false);
        read.mockRejectedValueOnce(new Error('offline')); await service.load(true);
        expect(service.ready()).toBe(false); expect(service.error()).toContain('Standard');
        read.mockResolvedValueOnce({ data: consent, error: null });
        window.dispatchEvent(new Event('online')); await service.load(); expect(service.active()).toBe(true);
    });

    it('invalidates a read already in flight when another tab changes consent', async () => {
        const { service, read } = setup(); const old = deferred(); read.mockReturnValueOnce(old.promise);
        const initial = service.load();
        window.dispatchEvent(new StorageEvent('storage', { key: 'nvzn_ai_coaching_changed:A' }));
        await service.load(); old.resolve({ data: consent, error: null }); await initial;
        expect(service.active()).toBe(false); expect(read).toHaveBeenCalledTimes(2);
    });

    it('accepts only a complete, current-version consent record', () => {
        expect(hasCoachingConsent(consent)).toBe(true);
        for (const value of [null, [], true, {}, { ...consent, unhinged: 'true' }, { ...consent, consent_version: 2 },
            { ...consent, consented_at: null }, { ...consent, consented_at: 'invalid' }]) expect(hasCoachingConsent(value)).toBe(false);
    });
});
