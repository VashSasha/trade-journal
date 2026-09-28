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

describe('broker sync user isolation', () => {
    beforeEach(() => {
        setCacheSuspended(false);
        localStorage.removeItem('tradovate_last_sync_time:A');
        TestBed.configureTestingModule({ providers: [
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
                    connections: () => [{ id: 'connection-A', name: 'A', accounts: [] }],
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
            connections: () => [{ id: 'connection-A', name: 'A', accounts: [] }],
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
        const getAccountTradeReports = vi.fn(() => of(reports));
        const markSynced = vi.fn();
        const flushQueue = vi.fn().mockResolvedValue(undefined);
        const createTrade = vi.fn((incoming: any) => stored.push({ ...incoming, id: 'new', userId: 'A' }));
        const patchTradesFees = vi.fn();
        const recalculate = vi.fn();
        const backfill = vi.fn(() => 0);
        TestBed.configureTestingModule({ providers: [
            { provide: TradovateService, useValue: { getAccountTradeReports,
                connections: () => [
                    { id: 'connection-A', name: 'A', accounts: [] },
                    { id: 'connection-B', name: 'B', accounts: [] },
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
            createTrade, patchTradesFees, recalculate, backfill, previous };
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
        await expect(state.sync.fullSync()).rejects.toThrow('No accounts synced. Failed: Invalid Performance');
        expect(state.createTrade).not.toHaveBeenCalled();
        expect(state.backfill).not.toHaveBeenCalled();
        expect(state.flushQueue).not.toHaveBeenCalled();
        expect(state.markSynced).not.toHaveBeenCalled();
        expect(state.sync.lastSyncTime()).toEqual(state.previous);
    });

    it('does not advance checkpoints when saving healthy trades fails', async () => {
        const state = setupPartial();
        state.flushQueue.mockRejectedValueOnce(new Error('Offline'));
        await expect(state.sync.fullSync()).rejects.toThrow('Offline');
        expect(state.markSynced).not.toHaveBeenCalled();
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
});
