import { TestBed } from '@angular/core/testing';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';

interface SetupOptions {
    token?: string;
    plan?: 'free' | 'premium' | 'lifetime';
    expiresInMs?: number;
    silentRenew?: boolean;
    renewedPlan?: 'premium' | 'lifetime';
    paidByBilling?: boolean;
}

describe('OAuth provenance and entitlement refresh', () => {
    beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

    const setup = (options: SetupOptions = {}) => {
        const silentRenew = options.silentRenew ?? true;
        let entitlement = {
            plan: options.plan ?? (options.paidByBilling ? 'premium' : 'free'),
            discord_id: '123456789012345678',
            discord_plan_expires_at: new Date(Date.now() + (options.expiresInMs ?? 3_600_000)).toISOString(),
            beta_access: false,
        };
        let session = { user: {
            id: 'A', email: 'test@example.invalid',
            // Original signup can differ from the current OAuth provider.
            app_metadata: { provider: 'discord', providers: ['discord', 'google'] },
        }, provider_token: options.token } as Session;
        let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {};
        let controller = new AbortController();
        const renew = vi.fn(async (_name: string, request: { body: { provider_token?: string } }) => {
            if (!request.body.provider_token && !silentRenew) return { error: { message: 'Bot unavailable' } };
            entitlement = {
                ...entitlement,
                plan: options.paidByBilling ? 'premium' : (options.renewedPlan ?? 'premium'),
                discord_plan_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            };
            return { error: null as { message: string } | null };
        });
        const single = vi.fn(async () => ({ data: { ...entitlement }, error: null as { message: string } | null }));
        const rpc = vi.fn(() => ({ abortSignal: () => ({ single }) }));
        const oauth = vi.fn(async (_options: { provider: string; options: { redirectTo?: string } }) => ({ error: null }));
        const client = {
            auth: {
                onAuthStateChange: (cb: typeof listener) => { listener = cb; },
                getSession: async () => ({ data: { session } }),
                signInWithOAuth: oauth,
                signOut: vi.fn(async () => {}),
            },
            rpc,
            functions: { invoke: renew },
        };
        vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client } },
            { provide: UserSessionService, useValue: {
                ready: Promise.resolve(),
                capture: () => ({ userId: session.user.id, signal: controller.signal }),
                isCurrent: (scope: { signal: AbortSignal }) => !scope.signal.aborted,
                clear: () => { controller.abort(); controller = new AbortController(); },
            } },
        ] });
        return {
            auth: TestBed.inject(AuthService), renew, rpc, single, oauth,
            setEntitlement: (value: Partial<typeof entitlement>) => { entitlement = { ...entitlement, ...value }; },
            event: (event: AuthChangeEvent, nextSession = session) => {
                session = nextSession;
                listener(event, event === 'SIGNED_OUT' ? null : session);
            },
        };
    };

    it('never sends a Google token to Discord, even when Discord was the original signup', async () => {
        const { auth, renew, rpc, event } = setup({ token: 'fake-google-token' });
        event('INITIAL_SESSION');
        await auth.authReady;
        await auth.completeOAuth('google');
        await vi.advanceTimersByTimeAsync(0);
        await Promise.all([auth.refreshProfile(), auth.refreshProfile()]);
        expect(renew).not.toHaveBeenCalled();
        expect(rpc).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('free');
    });

    it('does not guess a token provider on restored or old callbacks', async () => {
        const { auth, renew } = setup({ token: 'unknown-provider-token' });
        await auth.authReady;
        await auth.completeOAuth(null);
        expect(renew).not.toHaveBeenCalled();
    });

    it('resolves an explicit Discord callback and renews its verified credential', async () => {
        const { auth, renew, setEntitlement } = setup({ token: 'fake-discord-token' });
        await auth.completeOAuth('discord');
        expect(renew).toHaveBeenCalledOnce();
        expect(renew.mock.calls[0][1].body).toEqual({ provider_token: 'fake-discord-token' });
        expect(auth.plan()).toBe('premium');
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1).toISOString() });
        await vi.advanceTimersByTimeAsync(31_000);
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledTimes(2);
        expect(renew.mock.calls[1][1].body).toEqual({ provider_token: 'fake-discord-token' });
        expect(auth.plan()).toBe('premium');
    });

    it('silently renews an expired lifetime role after returning to an idle tab', async () => {
        const { auth, renew } = setup({
            plan: 'free', expiresInMs: -1, renewedPlan: 'lifetime',
        });
        await auth.authReady;
        expect(renew).toHaveBeenCalledOnce();
        expect(renew.mock.calls[0][1].body).toEqual({});
        expect(auth.plan()).toBe('lifetime');
        expect(auth.discordReauthRequired()).toBe(false);
    });

    it('uses silent verification after a Google callback clears the Discord credential', async () => {
        const { auth, renew, setEntitlement } = setup({ token: 'fake-discord-token' });
        await auth.completeOAuth('discord');
        await auth.completeOAuth('google');
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1).toISOString() });
        await auth.refreshProfile({ force: true });
        expect(renew).toHaveBeenCalledTimes(2);
        expect(renew.mock.calls[1][1].body).toEqual({});
        expect(auth.plan()).toBe('premium');
    });

    it('shares overlapping refreshes and caches subsequent guard/focus checks briefly', async () => {
        const { auth, rpc, single } = setup();
        await auth.authReady;
        await vi.advanceTimersByTimeAsync(31_000);
        const response = await single();
        let finish!: (value: typeof response) => void;
        single.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const requests = [auth.refreshProfile(), auth.refreshProfile(), auth.refreshProfile()];
        await Promise.resolve();
        expect(rpc).toHaveBeenCalledTimes(2);
        finish(response);
        await Promise.all(requests);
        await auth.refreshProfile();
        expect(rpc).toHaveBeenCalledTimes(2);
        await auth.refreshProfile({ force: true });
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('backs off after a failed renewal instead of retrying on every guard check', async () => {
        const { auth, renew, setEntitlement } = setup({ token: 'fake-discord-token' });
        await auth.completeOAuth('discord');
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1).toISOString() });
        renew.mockResolvedValueOnce({ error: { message: 'Unauthorized' } });
        await auth.refreshProfile({ force: true });
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledTimes(2);
        expect(auth.plan()).toBe('free');
        expect(auth.discordReauthRequired()).toBe(true);
    });

    it('does not send another tab\'s Google provider token during silent renewal', async () => {
        const { auth, renew, event, setEntitlement } = setup({ token: 'fake-discord-token' });
        await auth.completeOAuth('discord');
        event('SIGNED_IN', { ...auth.session()!, provider_token: 'fake-google-token' });
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1).toISOString() });
        await auth.refreshProfile({ force: true });
        expect(renew).toHaveBeenCalledTimes(2);
        expect(renew.mock.calls[1][1].body).toEqual({});
    });

    it('does not cache a paid Discord lease beyond expiry when verification is unavailable', async () => {
        const { auth, renew, setEntitlement } = setup({
            plan: 'premium', expiresInMs: 16 * 60_000, silentRenew: false,
        });
        await auth.authReady;
        vi.setSystemTime(new Date(Date.now() + 16 * 60_000 + 1));
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1).toISOString() });
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('free');
    });

    it('preserves the last loaded plan when an entitlement read fails transiently', async () => {
        const { auth, single } = setup({ plan: 'lifetime' });
        await auth.authReady;
        single.mockResolvedValueOnce({ data: null as never, error: { message: 'Network unavailable' } });
        await auth.refreshProfile({ force: true });
        expect(auth.plan()).toBe('lifetime');
    });

    it('invalidates in-flight results and cached permissions on logout', async () => {
        const { auth, single, event } = setup();
        await auth.authReady;
        const response = await single();
        let finish!: (value: typeof response) => void;
        single.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = auth.refreshProfile({ force: true });
        await Promise.resolve();
        auth.logout();
        finish({ ...response, data: { ...response.data, plan: 'premium' } });
        await pending;
        expect(auth.plan()).toBe('free');
        expect(auth.isAuthenticated()).toBe(false);
        event('SIGNED_IN');
        await vi.advanceTimersByTimeAsync(0);
        expect(auth.plan()).toBe('free');
    });

    it('asks for Discord sign-in when neither silent verification nor a credential is available', async () => {
        const { auth, renew } = setup({ expiresInMs: -1, silentRenew: false });
        await auth.authReady;
        expect(renew).toHaveBeenCalledOnce();
        expect(renew.mock.calls[0][1].body).toEqual({});
        expect(auth.plan()).toBe('free');
        expect(auth.discordReauthRequired()).toBe(true);
    });

    it('never asks a billing-backed user to reauthenticate for paid access', async () => {
        const { auth } = setup({ expiresInMs: -1, silentRenew: false, paidByBilling: true });
        await auth.authReady;
        expect(auth.plan()).toBe('premium');
        expect(auth.discordReauthRequired()).toBe(false);
    });

    it('remembers the selected provider without changing allowed OAuth callback URLs', async () => {
        const { auth, oauth, renew } = setup({ token: 'fake-discord-token' });
        await auth.authReady;
        await auth.loginWithGoogle();
        await auth.completeOAuth();
        expect(renew).not.toHaveBeenCalled();
        await auth.loginWithDiscord();
        await auth.completeOAuth();
        expect(renew).toHaveBeenCalledOnce();
        await auth.completeOAuth();
        expect(renew).toHaveBeenCalledOnce();
        for (const [call] of oauth.mock.calls) {
            expect(call.options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
        }
    });

    it('does not reuse an abandoned OAuth flow marker', async () => {
        const { auth, renew } = setup({ token: 'unknown-provider-token' });
        await auth.authReady;
        await auth.loginWithDiscord();
        await vi.advanceTimersByTimeAsync(16 * 60_000);
        await auth.completeOAuth();
        expect(renew).not.toHaveBeenCalled();
    });
});
