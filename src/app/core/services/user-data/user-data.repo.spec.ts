import { Injector, runInInjectionContext } from '@angular/core';
import { vi } from 'vitest';
import { SupabaseService } from '../supabase.service';
import { UserSessionService } from '../user-session.service';
import { UserDataRepo } from './user-data.repo';
import { Trade } from '../../models/trade.model';

describe('owner-bound persistence', () => {
    let callback: (_event: string, session: any) => void;
    let session: UserSessionService;
    let client: any;
    const from = (result: () => any) => {
        const query: any = { select: () => query, eq: () => query, order: () => query, limit: () => query,
            gt: () => query, abortSignal: () => query, maybeSingle: () => query,
            then: (yes: any, no: any) => Promise.resolve().then(result).then(yes, no) };
        return query;
    };
    const repo = () => runInInjectionContext(Injector.create({ providers: [
        { provide: SupabaseService, useValue: { client } },
        { provide: UserSessionService, useValue: session }
    ] }), () => new UserDataRepo());
    beforeEach(async () => {
        localStorage.clear(); vi.useFakeTimers();
        client = { auth: { onAuthStateChange: (cb: any) => { callback = cb; },
            getSession: async () => ({ data: { session: { user: { id: 'A' } } } }) } };
        session = runInInjectionContext(Injector.create({ providers: [
            { provide: SupabaseService, useValue: { client } }
        ] }), () => new UserSessionService());
        await session.ready;
    });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
    it('invalidates old work even when the same user logs back in', () => {
        const old = session.capture(); session.clear();
        callback('SIGNED_IN', { user: { id: 'A' } });
        expect(session.isCurrent(old)).toBe(false);
    });
    it('rejects a read completed after another user signs in', async () => {
        let finish: (v: any) => void;
        client.from = () => from(() => new Promise(resolve => { finish = resolve; }));
        const pending = repo().fetchTrades();
        const assertion = expect(pending).rejects.toThrow('session changed');
        await Promise.resolve(); await Promise.resolve();
        callback('SIGNED_IN', { user: { id: 'B' } });
        finish!({ data: [], error: null });
        await assertion;
    });
    it('fetches all pages even when the server cap is smaller than requested', async () => {
        const all = Array.from({ length: 1205 }, (_, i) => ({ id: String(i).padStart(5, '0'), user_id: 'A', entry_date: '2026-01-01' }));
        const owners: string[] = [];
        client.from = () => {
            let cursor = '';
            const query = from(() => ({ data: all.filter(r => r.id > cursor).slice(0, 333), error: null }));
            query.gt = (_key: string, value: string) => { cursor = value; return query; };
            query.eq = (_key: string, value: string) => { owners.push(value); return query; };
            return query;
        };
        expect(await repo().fetchTrades()).toHaveLength(1205);
        expect(owners.every(owner => owner === 'A')).toBe(true);
        expect(owners).toHaveLength(5);
    });
    it('retains rejected saves across logout and never flushes them as another user', async () => {
        let rejected = true;
        const sent: any[] = [];
        client.rpc = (_name: string, args: any) => {
            sent.push(args);
            return from(() => rejected ? { error: { message: 'constraint failure' } } : { data: [], error: null });
        };
        const store = repo();
        store.queueTradeUpserts([{ id: 'trade', userId: 'A' } as Trade]);
        expect(Object.keys(localStorage).some(k => k.startsWith('tj_outbox_v2:A:'))).toBe(true);
        await expect(store.flushQueue()).rejects.toBeTruthy();
        expect(store.pending()).toBe(1);
        expect(store.saveError()).toBeTruthy();
        callback('SIGNED_IN', { user: { id: 'B' } }); store.clearQueue();
        await store.flushQueue();
        expect(sent).toHaveLength(1);
        expect(sent[0].p_rows[0].user_id).toBe('A');
        callback('SIGNED_IN', { user: { id: 'A' } }); rejected = false;
        await store.flushQueue();
        expect(store.pending()).toBe(0);
        expect(store.saveError()).toBeNull();
    });
    it('rejects a trade belonging to a different user before queueing it', () => {
        expect(() => repo().queueTradeUpserts([{ userId: 'B' } as Trade])).toThrow('owner changed');
        expect(Object.keys(localStorage)).toHaveLength(0);
    });
});
