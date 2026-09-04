import { TestBed } from '@angular/core/testing';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';

describe('OAuth provenance and entitlement refresh', () => {
    beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
    const setup = (token?: string, paidByBilling = false) => {
        let entitlement = { plan: paidByBilling ? 'premium' : 'free', discord_id: '123456789012345678',
            discord_plan_expires_at: new Date(Date.now() - 1000).toISOString(), beta_access: false };
        let session = { user: {
            id: 'A', email: 'test@example.invalid',
            // Original signup can differ from the current OAuth provider.
            app_metadata: { provider: 'discord', providers: ['discord', 'google'] },
        }, provider_token: token } as Session;
        let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {};
        let controller = new AbortController();
        const renew = vi.fn(async () => {
            entitlement = { ...entitlement, plan: 'premium', discord_plan_expires_at: new Date(Date.now() + 3_600_000).toISOString() };
            return { error: null as { message: string } | null };
        });
        const single = vi.fn(async () => ({ data: { ...entitlement }, error: null }));
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
        const { auth, renew, rpc, event } = setup('fake-google-token');
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
        const { auth, renew } = setup('unknown-provider-token');
        await auth.authReady;
        await auth.completeOAuth(null);
        expect(renew).not.toHaveBeenCalled();
    });

    it('resolves an explicit Discord callback once and renews only its verified credential', async () => {
        const { auth, renew, setEntitlement } = setup('fake-discord-token');
        await auth.authReady;
        expect(renew).not.toHaveBeenCalled();
        await auth.completeOAuth('discord');
        expect(renew).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('premium');
        expect(auth.discordReauthRequired()).toBe(false);
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledOnce();
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1000).toISOString() });
        await vi.advanceTimersByTimeAsync(31_000);
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledTimes(2);
        expect(auth.plan()).toBe('premium');
    });

    it('discards a verified Discord credential after a Google callback', async () => {
        const { auth, renew, setEntitlement } = setup('fake-discord-token');
        await auth.completeOAuth('discord');
        await auth.completeOAuth('google');
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1000).toISOString() });
        await auth.refreshProfile({ force: true });
        expect(renew).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('free');
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

    it('does not keep retrying a rejected Discord credential', async () => {
        const { auth, renew, setEntitlement } = setup('fake-discord-token');
        await auth.completeOAuth('discord');
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1000).toISOString() });
        renew.mockResolvedValueOnce({ error: { message: 'Unauthorized' } });
        await auth.refreshProfile({ force: true });
        await auth.refreshProfile({ force: true });
        expect(renew).toHaveBeenCalledTimes(2); // Callback + one rejected renewal, not a retry loop.
        expect(auth.plan()).toBe('free');
        expect(auth.discordReauthRequired()).toBe(true);
    });

    it('discards a known Discord credential when another tab signs in through Google', async () => {
        const { auth, renew, event, setEntitlement } = setup('fake-discord-token');
        await auth.completeOAuth('discord');
        event('SIGNED_IN', { ...auth.session()!, provider_token: 'fake-google-token' });
        setEntitlement({ plan: 'free', discord_plan_expires_at: new Date(Date.now() - 1000).toISOString() });
        await auth.refreshProfile({ force: true });
        expect(renew).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('free');
    });

    it('does not cache a paid Discord lease beyond its expiry', async () => {
        const { auth, setEntitlement, rpc } = setup();
        await auth.authReady;
        setEntitlement({ plan: 'premium', discord_plan_expires_at: new Date(Date.now() + 1000).toISOString() });
        await auth.refreshProfile({ force: true });
        await vi.advanceTimersByTimeAsync(1001);
        setEntitlement({ plan: 'free' });
        await auth.refreshProfile();
        expect(rpc).toHaveBeenCalledTimes(3);
        expect(auth.plan()).toBe('free');
    });

    it('invalidates in-flight results and cached permissions on logout', async () => {
        const { auth, single, event, setEntitlement } = setup();
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
        setEntitlement({ plan: 'free' });
        event('SIGNED_IN');
        await vi.advanceTimersByTimeAsync(0);
        expect(auth.plan()).toBe('free');
    });
    it('asks for Discord sign-in when no credential can renew the expired role', async () => {
        const { auth, renew } = setup(undefined);
        await auth.authReady;
        expect(auth.plan()).toBe('free');
        expect(auth.discordReauthRequired()).toBe(true);
        expect(renew).not.toHaveBeenCalled();
    });
    it('never asks a billing-backed user to reauthenticate for paid access', async () => {
        const { auth } = setup(undefined, true);
        await auth.authReady;
        expect(auth.plan()).toBe('premium');
        expect(auth.discordReauthRequired()).toBe(false);
    });

    it('remembers the selected provider without changing allowed OAuth callback URLs', async () => {
        const { auth, oauth, renew } = setup('fake-discord-token');
        await auth.authReady;
        await auth.loginWithGoogle();
        await auth.completeOAuth();
        expect(renew).not.toHaveBeenCalled();
        await auth.loginWithDiscord();
        await auth.completeOAuth();
        expect(renew).toHaveBeenCalledOnce();
        await auth.completeOAuth();
        expect(renew).toHaveBeenCalledOnce(); // Callback marker is consumed, not reusable.
        for (const [call] of oauth.mock.calls) {
            expect(call.options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
        }
    });

    it('does not reuse an abandoned OAuth flow marker', async () => {
        const { auth, renew } = setup('unknown-provider-token');
        await auth.authReady;
        await auth.loginWithDiscord();
        await vi.advanceTimersByTimeAsync(16 * 60_000);
        await auth.completeOAuth();
        expect(renew).not.toHaveBeenCalled();
    });
});
