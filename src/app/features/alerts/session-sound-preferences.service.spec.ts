import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import { SessionSoundPreferencesService } from './session-sound-preferences.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const LEGACY_KEY = 'nvzn_session_sound_preferences_v1';
const CACHE_KEY = `nvzn_session_sound_preferences_v2:${OWNER}`;

describe('account-synced session sound preferences', () => {
    function setup(cloud: unknown = undefined, saveError: unknown = null) {
        const userId = signal<string | null>(OWNER);
        const controller = new AbortController();
        const maybeSingle = vi.fn(async () => ({
            data: cloud === undefined ? null : { prefs: { session_sounds: cloud } },
            error: null,
        }));
        const query: any = {
            select: () => query,
            eq: () => query,
            abortSignal: () => query,
            maybeSingle,
        };
        const rpcResult = vi.fn(async () => ({ data: null, error: saveError }));
        const rpc = vi.fn(() => ({ abortSignal: rpcResult }));
        const client = { from: vi.fn(() => query), rpc };
        const session = {
            userId,
            capture: (): UserOperation => {
                const owner = userId();
                if (!owner) throw new Error('not signed in');
                return { userId: owner, signal: controller.signal };
            },
            assertCurrent: (operation: UserOperation) => {
                if (operation.signal.aborted || operation.userId !== userId()) throw new Error('session changed');
            },
            isCurrent: (operation: UserOperation) =>
                !operation.signal.aborted && operation.userId === userId(),
        };
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client } },
            { provide: UserSessionService, useValue: session },
        ] });
        const service = TestBed.inject(SessionSoundPreferencesService);
        TestBed.tick();
        return { service, rpc, rpcResult };
    }

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('loads an enabled account preference in a fresh browser', async () => {
        const { service } = setup({ volume: 65, opens: true, closes: false, armed: true });

        await vi.waitFor(() => expect(service.loading()).toBe(false));

        expect(service.preferences()).toEqual({ volume: 65, opens: true, closes: false, armed: true });
        expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual(expect.objectContaining({
            pending: false,
            preferences: { volume: 65, opens: true, closes: false, armed: true },
        }));
    });

    it('migrates the previous browser-only preference to the signed-in account', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify({ volume: 55, opens: false, closes: true, armed: true }));
        const { service, rpc } = setup();

        await vi.waitFor(() => expect(rpc).toHaveBeenCalled());

        expect(service.preferences().armed).toBe(true);
        expect(rpc).toHaveBeenCalledWith('set_my_session_sound_preferences', {
            p_preferences: { volume: 55, opens: false, closes: true, armed: true },
        });
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('persists an opt-in immediately and keeps its browser cache owner-scoped', async () => {
        const { service, rpc } = setup({ volume: 45, opens: true, closes: true, armed: false });
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        service.update(value => ({ ...value, armed: true }));
        await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());

        expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).preferences.armed).toBe(true);
        expect(localStorage.getItem('nvzn_session_sound_preferences_v2:someone-else')).toBeNull();
    });

    it('keeps the local preference and reports a retryable cloud failure', async () => {
        const { service, rpcResult } = setup(
            { volume: 45, opens: true, closes: true, armed: false },
            { message: 'offline' },
        );
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        service.update(value => ({ ...value, armed: true }));
        await vi.waitFor(() => expect(rpcResult).toHaveBeenCalled());
        await vi.waitFor(() => expect(service.syncWarning()).toBe(true));

        expect(service.preferences().armed).toBe(true);
        expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).pending).toBe(true);
    });
});
