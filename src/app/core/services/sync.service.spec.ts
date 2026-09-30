import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { SyncService } from './sync.service';
import { TradovateAccountReport, TradovateService } from './tradovate.service';
import { Trade } from '../models/trade.model';
import { TradeService } from './trade.service';
import { AccountSettingsService } from './account-settings.service';
import { UserSessionService } from './user-session.service';
import { SupabaseService } from './supabase.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { AuthService } from './auth.service';
import { setCacheSuspended } from './user-data/user-data.cache';
import { BrokerSyncHistoryService } from '../../features/integrations/sync-status/broker-sync-history.service';
import { BrokerAccountRequest } from '../../features/integrations/sync-status/broker-sync.model';

describe('broker sync user isolation', () => {
    beforeEach(() => {
        setCacheSuspended(false);
        localStorage.removeItem('tradovate_last_sync_time:A');
        localStorage.removeItem('tradovate_pending_sync:A');
        TestBed.configureTestingModule({ providers: [
            { provide: BrokerSyncHistoryService, useValue: { record: vi.fn(async () => {}) } },
            { provide: AuthService, useValue: { plan: () => 'premium', isAuthenticated: () => true } }
        ] });
    });
    afterEach(() => setCacheSuspended(false));
    for (const failure of ['report', 'final-save']) {
        it(`keeps the previous checkpoint after a ${failure} failure`, async () => {
            const previous = new Date('2026-07-01T12:00:00Z');
            const controller = new AbortController();
            const markSynced = vi.fn();
            const flushQueue = vi.fn().mockResolvedValue(undefined);
            if (failure === 'final-save') flushQueue.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Offline'));
            TestBed.configureTestingModule({ providers: [
                { provide: TradovateService, useValue: {
                    connections: () => [{ id: 'connection-A', name: 'A', accounts: [{ id: 1, name: 'A' }] }],
                    ensureFreshToken: async () => {}, updateConnectionSyncTime: markSynced,
                    getAccountTradeReports: () => failure === 'report' ? throwError(() => new Error('Report failed'))
                        : of([{ connectionId: 'connection-A', accountId: 1, accountName: 'A', trades: [] }]),
                } },
                { provide: UserSessionService, useValue: {
                    userId: () => 'A', capture: () => ({ userId: 'A', signal: controller.signal }),
                    assertCurrent: () => {}, isCurrent: () => true,
                } },
                { provide: TradeService, useValue: { backfillConnectionIds: () => 0, trades: () => [],
                    recalculateTradovateNetPnl: () => ({ grossPnl: 0, totalFees: 0, netPnl: 0 }) } },
                { provide: AccountSettingsService, useValue: { commissionPerContract: () => 0 } },
                { provide: UserDataRepo, useValue: { flushQueue } },
            ] });
            const sync = TestBed.inject(SyncService);
            TestBed.tick();
            sync.lastSyncTime.set(previous);
            await expect(sync.fullSync()).rejects.toThrow();
            expect(sync.lastSyncTime()).toEqual(previous);
            expect(sync.isSyncing()).toBe(false);
            if (failure === 'report') expect(markSynced).not.toHaveBeenCalled();
        });
    }
    it('never imports A’s late broker response into B’s journal', async () => {
        let onAuth: (_event: string, session: unknown) => void = () => undefined;
        const client = { auth: {
            onAuthStateChange: (cb: typeof onAuth) => { onAuth = cb; },
            getSession: async () => ({ data: { session: { user: { id: 'A' } } } })
        } };
        const session = runInInjectionContext(Injector.create({ providers: [
            { provide: SupabaseService, useValue: { client } }
        ] }), () => new UserSessionService());
        await session.ready;
        const response = new Subject<any[]>();
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const createTrade = vi.fn();
        const broker = {
            connections: () => [{ id: 'connection-A', name: 'A', accounts: [{ id: 1, name: 'A' }] }],
            ensureFreshToken: async () => undefined,
            getAccountTradeReports: () => { started(); return response; }
        };
        TestBed.configureTestingModule({ providers: [
            { provide: TradovateService, useValue: broker },
            { provide: UserSessionService, useValue: session },
            { provide: TradeService, useValue: { createTrade, backfillConnectionIds: () => 0 } },
            { provide: AccountSettingsService, useValue: {} },
            { provide: UserDataRepo, useValue: {} }
        ] });
        const sync = TestBed.runInInjectionContext(() => new SyncService());
        const pending = sync.syncFrom(null);
        const rejected = expect(pending).rejects.toBeTruthy();
        await ready;
        onAuth('SIGNED_IN', { user: { id: 'B' } });
        response.next([{ externalId: 'trade-A' }]);
        await rejected;
        expect(createTrade).not.toHaveBeenCalled();
        expect(sync.isSyncing()).toBe(false);
    });

    function setupPartial() {
        const trade = { symbol: 'MNQ', assetType: 'futures' as const, direction: 'long' as const,
            quantity: 1, entryDate: '2026-09-23T13:00:00Z', exitDate: '2026-09-23T13:10:00Z',
            entryPrice: 20000, exitPrice: 20050, pnl: 100, status: 'closed' as const,
            externalId: 'tradovate_perf_1_MNQ_111_222', accountId: '1', connectionId: 'connection-A' };
        const historical: Trade = { ...trade, id: 'old', userId: 'A', source: 'tradovate',
            accountId: '2', externalId: 'old-external', fees: 7, netPnl: 93,
            createdAt: '2026-09-01', updatedAt: '2026-09-01' };
        const stored: Trade[] = [historical];
        const reports: TradovateAccountReport[] = [
            { connectionId: 'connection-A', accountId: 1, accountName: 'Healthy', trades: [trade] },
            { connectionId: 'connection-A', accountId: 2, accountName: 'Failed', trades: [], error: 'Invalid Performance report row 2: invalid or missing pnl.' },
            { connectionId: 'connection-B', accountId: 3, accountName: 'Verified empty', trades: [] },
        ];
        const getAccountTradeReports = vi.fn((_from: Date | null, _to?: Date, targets?: readonly BrokerAccountRequest[]) =>
            of(reports.filter(r => !targets || targets.some(t => t.accountId === r.accountId && t.connectionId === r.connectionId))));
        const markSynced = vi.fn();
        const flushQueue = vi.fn().mockResolvedValue(undefined);
        const createTrade = vi.fn((incoming: any) => stored.push({ ...incoming, id: 'new', userId: 'A' }));
        const patchTradesFees = vi.fn();
        const recalculate = vi.fn();
        const backfill = vi.fn(() => 0);
        const record = vi.fn(async () => {});
        TestBed.configureTestingModule({ providers: [
            { provide: BrokerSyncHistoryService, useValue: { record } },
            { provide: TradovateService, useValue: { getAccountTradeReports,
                connections: () => [
                    { id: 'connection-A', name: 'A', accounts: [{ id: 1, name: 'Healthy' }, { id: 2, name: 'Failed' }] },
                    { id: 'connection-B', name: 'B', accounts: [{ id: 3, name: 'Verified empty' }] },
                    { id: 'historical-connection', name: 'Historical', accounts: [] },
                ], ensureFreshToken: async () => {}, updateConnectionSyncTime: markSynced } },
            { provide: UserSessionService, useValue: {
                userId: () => 'A', capture: () => ({ userId: 'A', signal: new AbortController().signal }),
                assertCurrent: () => {}, isCurrent: () => true,
            } },
            { provide: TradeService, useValue: { trades: () => stored, createTrade, patchTradesFees,
                backfillConnectionIds: backfill, recalculateTradovateNetPnl: recalculate } },
            { provide: AccountSettingsService, useValue: { commissionPerContract: () => 0.25 } },
            { provide: UserDataRepo, useValue: { flushQueue } },
        ] });
        const sync = TestBed.inject(SyncService);
        TestBed.tick();
        const previous = new Date('2026-09-16T12:00:00Z');
        sync.lastSyncTime.set(previous);
        localStorage.setItem('tradovate_last_sync_time:A', previous.toISOString());
        return { sync, reports, stored, historical, getAccountTradeReports, markSynced, flushQueue,
            createTrade, patchTradesFees, recalculate, backfill, previous, record };
    }

    it('saves healthy accounts, preserves failed history, and advances only complete connections', async () => {
        const state = setupPartial();
        expect(await state.sync.fullSync()).toBe(1);
        expect(state.stored[0]).toBe(state.historical);
        expect(state.stored[1]).toMatchObject({ fees: 0.5, netPnl: 99.5 });
        expect(state.backfill).toHaveBeenCalledWith('connection-A', new Set(['1']));
        expect(state.recalculate).not.toHaveBeenCalled();
        expect(state.patchTradesFees).not.toHaveBeenCalled();
        expect(state.markSynced.mock.calls).toEqual([['connection-B']]);
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
        expect(localStorage.getItem('tradovate_last_sync_time:A')).toBe(state.previous.toISOString());
        expect(state.sync.syncWarning()).toContain('2 of 3 accounts synced');
        expect(state.sync.syncLog().some(entry => entry.message.includes('A / Failed: Invalid Performance report row 2'))).toBe(true);
    });

    it('retries partial sync without duplicates and advances the global date only after recovery', async () => {
        const state = setupPartial();
        await state.sync.fullSync();
        expect(await state.sync.fullSync()).toBe(0);
        expect(state.createTrade).toHaveBeenCalledOnce();
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
        state.getAccountTradeReports.mockReturnValue(of(state.reports.map(report => ({ ...report, error: undefined }))));
        await state.sync.fullSync();
        expect(state.createTrade).toHaveBeenCalledOnce();
        expect(state.sync.syncWarning()).toBeNull();
        expect(state.sync.lastSyncTime()!.getTime()).toBeGreaterThan(state.previous.getTime());
    });

    it('never reports an all-failed sync as an empty success or advances checkpoints', async () => {
        const state = setupPartial();
        state.getAccountTradeReports.mockReturnValue(of([state.reports[1]]));
        await expect(state.sync.fullSync()).rejects.toThrow('No accounts synced.');
        expect(state.createTrade).not.toHaveBeenCalled();
        expect(state.backfill).not.toHaveBeenCalled();
        expect(state.flushQueue).not.toHaveBeenCalled();
        expect(state.markSynced).not.toHaveBeenCalled();
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
    });

    it('does not advance a failed account checkpoint when saving fails, but still saves other accounts', async () => {
        const state = setupPartial();
        state.flushQueue.mockRejectedValueOnce(new Error('Offline'));
        await expect(state.sync.fullSync()).resolves.toBe(0);
        expect(state.markSynced.mock.calls).toEqual([['connection-B']]);
        expect(state.record).toHaveBeenCalledOnce();
        expect(state.sync.accountResults().find(r => r.accountId === 1)?.state).toBe('failed');
        expect(state.sync.accountResults().find(r => r.accountId === 3)?.state).toBe('synced');
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
        expect(state.sync.isSyncing()).toBe(false);
    });

    it('does not label no eligible accounts as a completed sync', async () => {
        const state = setupPartial();
        state.getAccountTradeReports.mockReturnValue(of([]));
        await expect(state.sync.fullSync()).rejects.toThrow('No active broker accounts');
        expect(state.markSynced).not.toHaveBeenCalled();
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
    });

    it('retries only failed accounts using the original date window and does not duplicate healthy trades', async () => {
        const state = setupPartial();
        const from = new Date('2026-08-01T00:00:00Z');
        await state.sync.syncFrom(from);
        const originalEnd = state.getAccountTradeReports.mock.calls[0][1];
        expect(state.record.mock.calls).toHaveLength(2);
        state.reports[1].error = undefined;
        state.sync.clearLog(); // Retry context survives log clearing.
        expect(await state.sync.retryFailedAccounts()).toBe(0);
        const [retryFrom, retryEnd, targets] = state.getAccountTradeReports.mock.calls[1];
        expect(retryFrom).toEqual(from); expect(retryEnd).toEqual(originalEnd);
        expect(targets?.map(t => t.accountId)).toEqual([2]);
        expect(state.createTrade).toHaveBeenCalledOnce();
        expect(state.sync.accountResults().every(r => r.state === 'synced')).toBe(true);
        expect(state.sync.lastSyncTime()).toEqual(originalEnd);
        expect(state.sync.retryableAccounts()).toHaveLength(0);
        expect(state.sync.syncWarning()).toBeNull();
    });

    it('does not stamp success until saving and the account receipt have both completed', async () => {
        const state = setupPartial();
        let saved!: () => void;
        state.flushQueue.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve; }));
        const pending = state.sync.fullSync();
        await vi.waitFor(() => expect(state.sync.accountResults()[0].state).toBe('saving'));
        expect(state.record).not.toHaveBeenCalled();
        saved(); await pending;
        expect(state.record).toHaveBeenCalledTimes(2);
        expect(state.sync.accountResults()[0].state).toBe('synced');
    });

    it('retains saved trades but marks an unconfirmed receipt for a safe retry', async () => {
        const state = setupPartial();
        state.record.mockRejectedValueOnce(new Error('Trades saved, but the sync time could not be recorded. Retrying is safe.'));
        await state.sync.fullSync();
        expect(state.createTrade).toHaveBeenCalledOnce();
        expect(state.sync.accountResults().find(r => r.accountId === 1)?.state).toBe('failed');
        await state.sync.retryFailedAccounts();
        expect(state.createTrade).toHaveBeenCalledOnce();
        expect(state.sync.accountResults().find(r => r.accountId === 1)?.state).toBe('synced');
    });

    it('cancels an in-flight report without saving, then allows a targeted retry', async () => {
        const state = setupPartial();
        const reports = new Subject<TradovateAccountReport[]>();
        state.getAccountTradeReports.mockReturnValueOnce(reports);
        const pending = state.sync.fullSync();
        const rejected = expect(pending).rejects.toThrow('cancelled');
        state.sync.cancelSync(); await rejected;
        expect(state.createTrade).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
        expect(state.sync.accountResults().every(r => r.state === 'cancelled')).toBe(true);
        expect(state.sync.retryableAccounts()).toHaveLength(3);
        await state.sync.retryFailedAccounts();
        expect(state.sync.isSyncing()).toBe(false);
    });

    it('suppresses duplicate sync clicks and refuses invalid dates before broker calls', async () => {
        const state = setupPartial();
        await expect(state.sync.syncFrom(new Date('invalid'))).rejects.toThrow('valid import date');
        expect(state.getAccountTradeReports).not.toHaveBeenCalled();
        const reports = new Subject<TradovateAccountReport[]>();
        state.getAccountTradeReports.mockReturnValueOnce(reports);
        const first = state.sync.fullSync();
        expect(await state.sync.fullSync()).toBe(0);
        expect(await state.sync.retryFailedAccounts()).toBe(0);
        expect(state.getAccountTradeReports).toHaveBeenCalledOnce();
        reports.next(state.reports); reports.complete(); await first;
    });

    it('preserves a failed full-history range across a later short background refresh', async () => {
        const state = setupPartial();
        await state.sync.fullSync();
        const recent = new Date('2026-09-29T00:00:00Z');
        await state.sync.syncFrom(recent);
        const requests = state.getAccountTradeReports.mock.calls[1][2]!;
        expect(requests.find(r => r.accountId === 1)?.fromDate).toEqual(recent);
        expect(requests.find(r => r.accountId === 2)?.fromDate).toBeNull();
        expect(state.sync.accountResults().find(r => r.accountId === 2)?.fromDate).toBeNull();
        state.reports[1].error = undefined;
        await state.sync.retryFailedAccounts();
        const retry = state.getAccountTradeReports.mock.calls[2][2]!;
        expect(retry).toHaveLength(1); expect(retry[0].fromDate).toBeNull();
    });

    it('quarantines an ambiguous duplicate on one account without preventing a different account from saving', async () => {
        const state = setupPartial();
        state.stored[0].externalId = 'legacy_2026-09-23T13:00:00Z';
        state.reports[1] = { ...state.reports[1], error: undefined, trades: [{ ...state.historical, externalId: 'different-fill-id' }] };
        await state.sync.fullSync();
        expect(state.sync.accountResults().find(r => r.accountId === 2)?.message).toContain('cross-format duplicate');
        expect(state.sync.accountResults().find(r => r.accountId === 1)?.state).toBe('synced');
        expect(state.sync.accountResults().find(r => r.accountId === 3)?.state).toBe('synced');
        expect(state.stored[0]).toBe(state.historical);
    });

    it('restores unresolved ranges after a reload, without treating device state as a success', async () => {
        const state = setupPartial();
        await state.sync.fullSync();
        const reloaded = TestBed.runInInjectionContext(() => new SyncService()); TestBed.tick();
        expect(reloaded.accountResults()).toHaveLength(1);
        expect(reloaded.retryableAccounts()[0].accountId).toBe(2);
        expect(reloaded.accountResults()[0].state).toBe('failed');
        state.reports[1].error = undefined;
        await reloaded.retryFailedAccounts();
        const requested = state.getAccountTradeReports.mock.calls[1][2]!;
        expect(requested).toHaveLength(1); expect(requested[0].fromDate).toBeNull();
        expect(JSON.parse(localStorage.getItem('tradovate_pending_sync:A')!)).toEqual([]);
        expect(state.createTrade).toHaveBeenCalledOnce();
    });
});
