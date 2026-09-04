import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AccessPolicyService } from './access-policy.service';
import { AuthService } from './auth.service';
import { UserOperation, UserSessionService } from './user-session.service';
import { setCacheSuspended } from './user-data/user-data.cache';

describe('shared workspace access policy', () => {
    const plan = signal('free');
    const signedIn = signal(true);
    let access: AccessPolicyService;
    beforeEach(() => {
        setCacheSuspended(false); plan.set('free'); signedIn.set(true);
        TestBed.configureTestingModule({ providers: [
            { provide: AuthService, useValue: { plan, isAuthenticated: signedIn } },
            { provide: UserSessionService, useValue: {
                capture: () => ({ userId: 'A', signal: new AbortController().signal }),
                isCurrent: (scope: UserOperation) => !scope.signal.aborted,
                assertCurrent: (scope: UserOperation) => { if (scope.signal.aborted) throw new Error('Workspace changed'); },
            } },
        ] });
        access = TestBed.inject(AccessPolicyService);
    });
    afterEach(() => setCacheSuspended(false));

    it('allows free manual journaling but not broker, analytics or real AI', () => {
        expect(access.canAct('save')).toBe(true);
        for (const feature of ['analytics', 'ai', 'broker'] as const) expect(access.canOpen(feature)).toBe(false);
        for (const action of ['connect', 'sync', 'ai'] as const) expect(access.canAct(action)).toBe(false);
    });
    it.each(['premium', 'lifetime'])('grants the same full real workspace to %s', tier => {
        plan.set(tier);
        for (const feature of ['analytics', 'ai', 'broker'] as const) expect(access.canOpen(feature)).toBe(true);
        for (const action of ['save', 'connect', 'sync', 'ai'] as const) expect(access.canAct(action)).toBe(true);
    });
    it.each(['free', 'premium', 'lifetime'])('allows previews, never live actions, in %s demo', tier => {
        plan.set(tier); setCacheSuspended(true);
        expect(access.canOpen('analytics')).toBe(true);
        expect(access.canOpen('ai')).toBe(true);
        expect(access.canOpen('broker')).toBe(false);
        for (const action of ['save', 'connect', 'sync', 'ai'] as const) expect(access.canAct(action)).toBe(false);
    });
    it('allows guests to preview but never mutate real data', () => {
        signedIn.set(false); setCacheSuspended(true);
        expect(access.canOpen('analytics')).toBe(true);
        expect(access.canAct('save')).toBe(false);
        expect(access.canAct('connect')).toBe(false);
    });
    it('invalidates old work even if the user enters and immediately leaves demo', () => {
        const scope = access.capture();
        setCacheSuspended(true); setCacheSuspended(false);
        expect(access.isCurrent(scope)).toBe(false);
        expect(() => access.assertCurrent(scope)).toThrow();
    });
    it('does not change workspace when a paid action is denied', () => {
        expect(access.requestAction('connect')).toBe(false);
        expect(access.promptReason()).toBe('connect');
        expect(access.demo()).toBe(false);
    });
    it('recognizes protected nested pages but leaves the basic journal and account settings open', () => {
        expect(access.featureForUrl('/settings/tradovate/callback?code=example')).toBe('broker');
        expect(access.featureForUrl('/journal/daily')).toBeNull();
        expect(access.featureForUrl('/account')).toBeNull();
    });
});
