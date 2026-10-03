import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './account.service';
import { AccountSettingsService } from './account-settings.service';
import { AccessPolicyService } from './access-policy.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';
import { TradeService } from './trade.service';
import { TradingAccountsService } from './trading-accounts.service';
import { TradovateAccount, TradovateConnection, TradovateService } from './tradovate.service';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { setCacheSuspended } from './user-data/user-data.cache';

function setup() {
    localStorage.clear(); setCacheSuspended(false);
    localStorage.setItem('tradovate_selected_account_ids:owner', '[1,2,3]');
    const conns = signal([{ id: 'live', name: 'Broker', accounts: [
        { id: 1, name: 'Old eval', active: true }, { id: 2, name: 'Recent funded', active: true },
    ] } as TradovateConnection]);
    const updateAccounts = vi.fn(), getAccounts = vi.fn(() => of(conns()[0].accounts));
    const getBalances = vi.fn(() => of([]));
    const owner = signal<string | null>('owner');
    const capture = () => ({ userId: owner(), signal: new AbortController().signal });
    const isCurrent = (scope: { userId: string | null }) => owner() === scope.userId;
    const sync = vi.fn().mockResolvedValue(undefined);
    const trades = signal([{ accountId: '1', netPnl: 100, status: 'closed' }, { accountId: '3', netPnl: -20, status: 'closed' }]);
    TestBed.configureTestingModule({ providers: [
        { provide: UserDataRepo, useValue: { queueTradingAccountUpserts: vi.fn() } },
        { provide: TradovateService, useValue: {
            connections: conns, allAccounts: computed(() => conns().flatMap(c => c.accounts)), isConnected: () => !!conns().length,
            getAccountsForConnection: getAccounts, getCashBalancesForConnection: getBalances,
        } },
        { provide: FilterService, useValue: { updateAccounts } },
        { provide: SyncService, useValue: { syncFrom: sync } },
        { provide: TradeService, useValue: { trades } },
        { provide: AccountSettingsService, useValue: { startingBalance: () => 50000 } },
        { provide: UserSessionService, useValue: { userId: owner, isCurrent, assertCurrent: vi.fn() } },
        { provide: AccessPolicyService, useValue: { canAct: () => true, requestAction: () => true, capture, isCurrent } },
    ] });
    const store = TestBed.inject(TradingAccountsService);
    store.hydrate([1, 2, 3].map(accountId => ({
        accountId, connectionId: accountId === 3 ? 'disconnected' : 'live', name: `Account ${accountId}`,
        accountType: 'eval', active: true, lastBalance: accountId * 1000,
        startingBalance: 50000, balanceUpdatedAt: '2026-10-01T12:00:00Z',
    })));
    const service = TestBed.inject(AccountService); TestBed.tick();
    return { service, store, conns, getAccounts, getBalances, updateAccounts, sync, trades };
}

afterEach(() => { TestBed.resetTestingModule(); setCacheSuspended(false); });
describe('account history and refresh', () => {
    it('orders active accounts first by recency, retains disconnected accounts and preserves totals when status changes', () => {
        const h = setup();
        expect(h.service.accounts().map(a => a.id)).toEqual([2, 1]);
        expect(h.service.historicalAccounts().map(a => a.id)).toEqual([3]);
        const trades = h.trades(), balance = h.service.currentBalance();
        h.store.recordAccounts('live', [h.conns()[0].accounts[1]]); TestBed.tick();
        expect(h.service.accounts().map(a => a.id)).toEqual([2]);
        expect(h.service.historicalAccounts().map(a => a.id)).toEqual([3, 1]);
        expect(h.service.selectedIds()).toEqual([1, 2, 3]);
        expect(h.service.currentBalance()).toBe(balance);
        expect(h.trades()).toBe(trades);
        expect(h.updateAccounts).toHaveBeenLastCalledWith(['1', '2', '3'], true);
    });

    it('refreshes cached account status on startup and prevents overlapping refresh requests', async () => {
        const h = setup(); const pending = new Subject<TradovateAccount[]>();
        h.getAccounts.mockReturnValue(pending);
        h.service.init(); h.service.init(); await h.service.refreshBalances();
        expect(h.getAccounts).toHaveBeenCalledOnce(); expect(h.service.isRefreshing()).toBe(true);
        expect(h.sync).not.toHaveBeenCalled(); // Startup status refresh doesn't reimport trades.
        pending.next(h.conns()[0].accounts); pending.complete();
        await vi.waitFor(() => expect(h.service.isRefreshing()).toBe(false));
    });

    it('keeps account status, balances and selection when a refresh fails', async () => {
        const h = setup(); h.getAccounts.mockReturnValue(throwError(() => new Error('offline')));
        h.service.init(); await vi.waitFor(() => expect(h.service.isRefreshing()).toBe(false));
        expect(h.service.accounts().map(a => a.id)).toEqual([2, 1]);
        expect(h.service.currentBalance()).toBe(6000);
        expect(h.service.selectedIds()).toEqual([1, 2, 3]);
    });
});
