import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { BrokerSyncHistoryService } from './broker-sync-history.service';
import { brokerAccountKey, BrokerSyncCheckpoint } from './broker-sync.model';

const target = { connectionId: 'connection', accountId: 123 };
const key = brokerAccountKey(target);
const receipt: BrokerSyncCheckpoint = {
    connection_id: 'connection', account_id: 123, synced_at: '2026-09-30T12:00:00Z',
    range_from: null, range_to: '2026-09-30T11:00:00Z',
};
type Result = { data: unknown; error: unknown };

function setup() {
    const userId = signal<string | null>('A'), demo = signal(false);
    let controller = new AbortController();
    let readResult: Promise<Result> = Promise.resolve({ data: [], error: null });
    let writeResult: Promise<Result> = Promise.resolve({ data: receipt, error: null });
    const eq = vi.fn();
    const from = vi.fn((table: string) => {
        expect(table).toBe('broker_sync_checkpoints');
        const query = { select: () => query, order: () => query, range: () => query,
            eq: (column: string, owner: string) => { eq(column, owner); return query; },
            abortSignal: () => readResult };
        return query;
    });
    const rpc = vi.fn(() => ({ abortSignal: () => writeResult }));
    const capture = () => ({ userId: userId()!, signal: controller.signal });
    const isCurrent = (scope: UserOperation) => !scope.signal.aborted && scope.userId === userId();
    const assertCurrent = (scope: UserOperation) => { if (!isCurrent(scope)) throw new Error('Session changed'); };
    TestBed.configureTestingModule({ providers: [
        { provide: SupabaseService, useValue: { client: { from, rpc } } },
        { provide: UserSessionService, useValue: { userId } },
        { provide: AccessPolicyService, useValue: { demo, capture, isCurrent, assertCurrent } },
    ] });
    const service = TestBed.inject(BrokerSyncHistoryService); TestBed.tick();
    return { service, from, rpc, eq, capture,
        read: (data: unknown) => { readResult = Promise.resolve({ data, error: null }); },
        fail: () => { readResult = Promise.resolve({ data: null, error: new Error('offline') }); },
        hold: (kind: 'read' | 'write') => {
            let resolve!: (result: Result) => void;
            const promise = new Promise<Result>(done => { resolve = done; });
            if (kind === 'read') readResult = promise; else writeResult = promise;
            return resolve;
        },
        switchUser: (owner: string | null) => { controller.abort(); controller = new AbortController(); userId.set(owner); TestBed.tick(); },
        setDemo: (value: boolean) => { controller.abort(); controller = new AbortController(); demo.set(value); TestBed.tick(); },
    };
}

afterEach(() => TestBed.resetTestingModule());

describe('persisted broker sync receipts', () => {
    it('loads lazily, once per owner, and restores timestamps without inferring success from balances', async () => {
        const h = setup(); expect(h.from).not.toHaveBeenCalled(); h.read([receipt]);
        await h.service.load(); await h.service.load();
        expect(h.from).toHaveBeenCalledOnce(); expect(h.eq).toHaveBeenCalledWith('user_id', 'A');
        expect(h.service.checkpoints().get(key)).toEqual(receipt);
        const saved = [...h.service.checkpoints().values()]; TestBed.resetTestingModule();
        const otherBrowser = setup(); otherBrowser.read(saved); await otherBrowser.service.load();
        expect(otherBrowser.service.checkpoints().get(key)?.synced_at).toBe(receipt.synced_at);
    });

    it('cannot let an older load overwrite a newly acknowledged sync', async () => {
        const h = setup(); const finish = h.hold('read'); const loading = h.service.load();
        await h.service.record(target, null, new Date(receipt.range_to), h.capture());
        finish({ data: [{ ...receipt, synced_at: '2026-09-01T00:00:00Z' }], error: null }); await loading;
        expect(h.service.checkpoints().get(key)?.synced_at).toBe(receipt.synced_at);
        expect(h.rpc).toHaveBeenCalledExactlyOnceWith('record_my_broker_sync', {
            p_connection_id: 'connection', p_account_id: 123, p_from: null, p_to: new Date(receipt.range_to).toISOString(),
        });
    });

    it('discards late reads and writes on owner changes and keeps demo isolated', async () => {
        const h = setup(); const read = h.hold('read'); const loading = h.service.load();
        h.switchUser('B'); read({ data: [receipt], error: null }); await loading;
        expect(h.service.checkpoints().size).toBe(0);
        const write = h.hold('write'); const saving = h.service.record(target, null, new Date(receipt.range_to), h.capture());
        const rejected = expect(saving).rejects.toThrow('Session changed');
        h.switchUser('C'); write({ data: receipt, error: null }); await rejected;
        expect(h.service.checkpoints().size).toBe(0);
        h.setDemo(true); await h.service.load(); expect(h.from).toHaveBeenCalledOnce();
    });

    it('shows unavailable history rather than falsely reporting never synced after a read error', async () => {
        const h = setup(); h.fail(); await h.service.load();
        expect(h.service.loaded()).toBe(false); expect(h.service.error()).toContain('unavailable');
        h.read([receipt]); await h.service.load(true);
        expect(h.service.loaded()).toBe(true); expect(h.service.error()).toBeNull();
    });

    it('does not update a receipt when its save is rejected', async () => {
        const h = setup(); h.read([receipt]); await h.service.load();
        const finish = h.hold('write'); const saving = h.service.record(target, null, new Date(), h.capture());
        finish({ data: null, error: new Error('missing migration') });
        await expect(saving).rejects.toThrow('Trades saved');
        expect(h.service.checkpoints().get(key)).toEqual(receipt);
    });
});
