import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { from } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { AccessPolicyService } from './access-policy.service';
import { TradingAccountsService } from './trading-accounts.service';
import { TradovateConnection, TradovateService } from './tradovate.service';

const CACHE = 'tj_cache_tradovate_connections';
const OWNER = 'tj_cache_tradovate_owner';
const ACTIVE = 'tj_cache_tradovate_active';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => resolve = done);
    return { promise, resolve };
}

function connection(id = 'valid', expired = false): TradovateConnection {
    return {
        id, name: id, token: `dummy-${id}`, mdToken: `dummy-md-${id}`,
        tokenExpiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(),
        config: { authMode: 'direct', environment: 'demo', username: 'fixture' },
        accounts: [{ id: 12, userId: 34, name: 'Fixture account', active: true, accountType: 'Customer' }],
        createdAt: new Date().toISOString(),
    };
}

function cache(owner: string | null, connections = [connection('expired', true), connection()]) {
    localStorage.setItem(CACHE, JSON.stringify(connections));
    localStorage.setItem(ACTIVE, 'valid');
    if (owner) localStorage.setItem(OWNER, owner);
}

function setup(userId: string, authReady = Promise.resolve()) {
    type Session = { user: { id: string } } | null;
    const session = signal<Session>({ user: { id: userId } });
    const callbacks: ((event: string, session: Session) => void)[] = [];
    const unsubscribe = vi.fn();
    const client = { auth: {
        getSession: async () => ({ data: { session: session() } }),
        onAuthStateChange: (cb: typeof callbacks[number]) => {
            callbacks.push(cb);
            return { data: { subscription: { unsubscribe } } };
        },
    } };
    const repo = {
        flushQueue: vi.fn(async () => undefined),
        fetchConnections: vi.fn<() => Promise<unknown[]>>(async () => []),
        queueConnectionUpserts: vi.fn(),
    };
    const http = { get: vi.fn(), post: vi.fn() };
    TestBed.configureTestingModule({ providers: [
        TradovateService, UserSessionService,
        { provide: AuthService, useValue: { session, authReady } },
        { provide: SupabaseService, useValue: { client } },
        { provide: HttpClient, useValue: http },
        { provide: UserDataRepo, useValue: repo },
        { provide: TradingAccountsService, useValue: { recordAccounts: vi.fn() } },
        { provide: AccessPolicyService, useValue: {
            assertAction: vi.fn(), canAct: () => true,
            capture: () => TestBed.inject(UserSessionService).capture(),
        } },
    ] });
    const service = TestBed.inject(TradovateService);
    const users = TestBed.inject(UserSessionService);
    return { service, users, repo, http, unsubscribe, session,
        changeUser(id: string | null) {
            session.set(id ? { user: { id } } : null);
            callbacks.forEach(cb => cb(id ? 'SIGNED_IN' : 'SIGNED_OUT', session()));
        },
    };
}

async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    TestBed.tick();
}

describe('Tradovate credential owner isolation', () => {
    beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
    afterEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear();
    });

    it('waits for restored authentication before exposing credentials or scheduling expiry', async () => {
        cache('A');
        const ready = deferred<void>();
        const { service, repo, http } = setup('A', ready.promise);
        await settle();
        expect(service.connections()).toEqual([]);
        expect(service.activeConnection()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        expect(repo.fetchConnections).not.toHaveBeenCalled();
        expect(http.get).not.toHaveBeenCalled();
        ready.resolve(); await settle();
        expect(service.connections()).toHaveLength(2);
        expect(service.activeConnection()?.token).toBe('dummy-valid');
    });

    it('does not relabel mixed expired/live foreign credentials or push them as the next user', async () => {
        cache('A');
        const original = localStorage.getItem(CACHE);
        const { service, repo, http } = setup('B');
        await settle();
        expect(service.connections()).toEqual([]);
        expect(service.settingsConnections()).toEqual([]);
        expect(service.accounts()).toEqual([]);
        expect(service.activeConnection()).toBeNull();
        expect(localStorage.getItem(OWNER)).toBe('A');
        expect(localStorage.getItem(CACHE)).toBe(original);
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(http.get).not.toHaveBeenCalled();
    });

    it('does not attach a foreign token to a cloud connection with the same id', async () => {
        cache('A');
        const { service, repo } = setup('B');
        repo.fetchConnections.mockResolvedValue([{ connection_id: 'valid', data: { name: 'B account' }, is_active: true }]);
        await settle();
        expect(service.connections()[0].name).toBe('B account');
        expect(service.connections()[0].token).toBe('');
        expect(service.connections()[0].mdToken).toBeUndefined();
        expect(service.connections()[0].accounts).toEqual([]);
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
    });

    it('rejects an interleaved cache write whose embedded owner differs from the separate marker', async () => {
        cache('B');
        localStorage.setItem(CACHE, JSON.stringify({ version: 1, owner: 'A', connections: [connection()] }));
        const { service, repo } = setup('B'); await settle();
        expect(service.connections()).toEqual([]);
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('restores a same-owner atomic cache after a reload', async () => {
        cache('A');
        localStorage.setItem(CACHE, JSON.stringify({ version: 1, owner: 'A', connections: [connection()] }));
        const { service } = setup('A'); await settle();
        expect(service.activeConnection()?.token).toBe('dummy-valid');
        expect(JSON.parse(localStorage.getItem(CACHE)!)).toMatchObject({ version: 1, owner: 'A' });
    });

    it('keeps same-owner cached connections usable offline and expires only their stale token', async () => {
        cache('A');
        const { service, repo } = setup('A');
        repo.fetchConnections.mockRejectedValue(new Error('offline'));
        await settle();
        expect(service.activeConnection()?.token).toBe('dummy-valid');
        expect(service.connections().find(c => c.id === 'expired')?.token).toBe('');
        expect(localStorage.getItem(OWNER)).toBe('A');
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        repo.fetchConnections.mockResolvedValue([]);
        window.dispatchEvent(new Event('online')); await settle();
        expect(repo.fetchConnections).toHaveBeenCalledTimes(2);
        expect(repo.queueConnectionUpserts).toHaveBeenCalledOnce();
        const metadata = JSON.stringify(repo.queueConnectionUpserts.mock.calls[0]);
        expect(metadata).not.toContain('dummy-');
    });

    it('quarantines ownerless and pre-cloud credentials without importing or erasing them', async () => {
        cache(null);
        localStorage.setItem('tradovate_connections', JSON.stringify([connection('legacy')]));
        localStorage.setItem('tradovate_token', 'dummy-unowned');
        localStorage.setItem('tradovate_config', JSON.stringify({ username: 'legacy' }));
        const snapshot = Object.entries(localStorage);
        const { service, repo } = setup('B'); await settle();
        expect(service.connections()).toEqual([]);
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        expect(Object.entries(localStorage)).toEqual(snapshot);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears visible data and timers on a cross-tab user change and ignores the previous cloud response', async () => {
        cache('A');
        const oldRead = deferred<unknown[]>();
        const { service, repo, changeUser } = setup('A');
        repo.fetchConnections.mockReturnValueOnce(oldRead.promise);
        await settle();
        expect(service.connections()).toHaveLength(2);
        changeUser('B');
        expect(service.connections()).toEqual([]);
        expect(service.accounts()).toEqual([]);
        await vi.advanceTimersByTimeAsync(0); await settle();
        oldRead.resolve([{ connection_id: 'stale', data: { name: 'A private' }, is_active: true }]);
        await settle();
        expect(service.connections()).toEqual([]);
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('hides credentials on local logout even without a successful remote sign-out event', async () => {
        cache('A');
        const { service, users, repo } = setup('A'); await settle();
        repo.queueConnectionUpserts.mockClear();
        users.clear();
        expect(service.connections()).toEqual([]);
        expect(service.activeConnection()).toBeNull();
        service.markConnectionExpired('valid');
        service.updateConnectionSyncTime('valid');
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
        await settle();
        expect(localStorage.getItem(CACHE)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores an in-flight token renewal after switching users', async () => {
        const nearExpiry = connection();
        nearExpiry.tokenExpiresAt = new Date(Date.now() + 120_000).toISOString();
        cache('A', [nearExpiry]);
        const { service, repo, http, changeUser } = setup('A'); await settle();
        const response = deferred<{ accessToken: string }>();
        http.post.mockReturnValue(from(response.promise));
        const pending = service.ensureFreshToken('valid');
        expect(http.post).toHaveBeenCalledOnce();
        changeUser('B');
        await vi.advanceTimersByTimeAsync(0); await settle();
        repo.queueConnectionUpserts.mockClear();
        response.resolve({ accessToken: 'dummy-renewed-A' });
        await pending; await settle();
        expect(service.connections()).toEqual([]);
        expect(localStorage.getItem(CACHE)).not.toContain('dummy-renewed-A');
        expect(repo.queueConnectionUpserts).not.toHaveBeenCalled();
    });

    it('persists a newly connected broker only for the established owner without cloud tokens', async () => {
        cache('A');
        const { service, repo } = setup('B'); await settle();
        service.addConnection('B new', 'dummy-B-token', { authMode: 'direct', environment: 'demo' });
        expect(localStorage.getItem(OWNER)).toBe('B');
        expect(JSON.parse(localStorage.getItem(CACHE)!)).toMatchObject({ version: 1, owner: 'B' });
        expect(localStorage.getItem(CACHE)).not.toContain('dummy-valid');
        expect(service.connections()).toHaveLength(1);
        const rows = repo.queueConnectionUpserts.mock.calls[0][0];
        expect(rows[0].data).not.toHaveProperty('token');
        expect(rows[0].data).not.toHaveProperty('mdToken');
    });

    it('unsubscribes and stops renewal timers when destroyed', async () => {
        cache('A');
        const { unsubscribe } = setup('A'); await settle();
        TestBed.resetTestingModule();
        expect(unsubscribe).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
