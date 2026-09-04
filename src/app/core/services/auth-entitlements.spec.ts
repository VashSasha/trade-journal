import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';

describe('renewable Discord entitlements', () => {
    beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
    const setup = (token: string | undefined, paidByBilling = false) => {
        let entitlement = { plan: paidByBilling ? 'premium' : 'free', discord_id: '123456789012345678',
            discord_plan_expires_at: new Date(Date.now() - 1000).toISOString(), beta_access: false };
        const renew = vi.fn(async () => {
            entitlement = { ...entitlement, plan: 'premium', discord_plan_expires_at: new Date(Date.now() + 3_600_000).toISOString() };
            return { error: null };
        });
        const client = {
            auth: { onAuthStateChange: () => {}, getSession: async () => ({ data: { session: {
                user: { id: 'A', email: 'test@example.invalid' }, provider_token: token,
            } } }) },
            rpc: () => ({ single: async () => ({ data: entitlement, error: null }) }),
            functions: { invoke: renew },
        };
        vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client } },
            { provide: UserSessionService, useValue: { capture: () => ({ signal: new AbortController().signal }), isCurrent: () => true } },
        ] });
        return { auth: TestBed.inject(AuthService), renew };
    };
    it('renews an expired lease before presenting the plan when a provider token is available', async () => {
        const { auth, renew } = setup('test-discord-token');
        await auth.authReady;
        expect(renew).toHaveBeenCalledOnce();
        expect(auth.plan()).toBe('premium');
        expect(auth.discordReauthRequired()).toBe(false);
        await auth.refreshProfile();
        expect(renew).toHaveBeenCalledOnce(); // No repeated Discord calls on fresh leases.
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
});
