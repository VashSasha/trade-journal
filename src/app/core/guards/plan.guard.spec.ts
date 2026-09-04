import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { UserSessionService } from '../services/user-session.service';
import { PaidFeature } from '../services/access-policy.service';
import { setCacheSuspended } from '../services/user-data/user-data.cache';
import { planGuard } from './plan.guard';

describe('plan guard navigation', () => {
    const plan = signal('free');
    const refreshProfile = vi.fn(async () => {});
    beforeEach(() => {
        plan.set('free'); setCacheSuspended(false); refreshProfile.mockClear();
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: AuthService, useValue: {
                authReady: Promise.resolve(), plan, refreshProfile, isAuthenticated: () => true,
            } },
            { provide: UserSessionService, useValue: {} },
        ] });
    });
    afterEach(() => setCacheSuspended(false));
    const check = (feature: PaidFeature = 'analytics') => TestBed.runInInjectionContext(() => planGuard(feature)(
        {} as ActivatedRouteSnapshot, { url: '/analytics' } as RouterStateSnapshot,
    ));

    it('shows an upgrade explanation instead of silently entering demo for free users', async () => {
        const result = await check();
        expect(result.toString()).toBe('/upgrade?feature=analytics');
        expect(refreshProfile).toHaveBeenCalledOnce();
    });

    it('admits premium and lifetime users without entering demo', async () => {
        for (const tier of ['premium', 'lifetime']) {
            plan.set(tier);
            expect(await check()).toBe(true);
        }
    });

    it('does not fetch entitlements while already in demo', async () => {
        setCacheSuspended(true);
        expect(await check()).toBe(true);
        expect(refreshProfile).not.toHaveBeenCalled();
    });

    it('allows demo activated while auth/profile restoration was in progress', async () => {
        refreshProfile.mockImplementationOnce(async () => { setCacheSuspended(true); });
        expect(await check()).toBe(true);
    });

    it('never treats demo as permission to open broker integrations, including paid users', async () => {
        setCacheSuspended(true);
        for (const tier of ['free', 'premium', 'lifetime']) {
            plan.set(tier);
            expect((await check('broker')).toString()).toBe('/upgrade?feature=broker');
        }
    });
});
