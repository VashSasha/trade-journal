import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradingAccountsService } from './trading-accounts.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { StoredTradingAccount } from './user-data/user-data.mappers';
import { TradovateAccount, TradovateCashBalance } from './tradovate.service';

const saved = (accountId: number, connectionId = 'a'): StoredTradingAccount => ({
    accountId, connectionId, name: `Account ${accountId}`, accountType: 'eval', active: true,
    lastBalance: 48000, startingBalance: 50000, balanceUpdatedAt: '2026-10-01T10:00:00Z',
});
const broker = (id: number, active = true): TradovateAccount => ({ id, name: `Account ${id}`, active, userId: 1, accountType: 'eval' });

describe('permanent trading accounts', () => {
    let service: TradingAccountsService;
    const upsert = vi.fn();
    beforeEach(() => {
        localStorage.clear(); upsert.mockClear();
        TestBed.configureTestingModule({ providers: [{ provide: UserDataRepo, useValue: { queueTradingAccountUpserts: upsert } }] });
        service = TestBed.inject(TradingAccountsService);
        service.hydrate([saved(1), saved(2), saved(3, 'b')]);
    });
    afterEach(() => TestBed.resetTestingModule());

    it('moves missing accounts to history only for the successfully refreshed connection, preserving balances', () => {
        service.recordAccounts('a', [broker(2), broker(4)]);
        expect(service.all()).toHaveLength(4);
        expect(service.byId().get(1)).toEqual({ ...saved(1), active: false });
        expect(service.byId().get(3)).toEqual(saved(3, 'b'));
        expect(service.byId().get(2)).toEqual(saved(2));
        expect(upsert).toHaveBeenCalledOnce();
    });

    it('accepts a successful empty list without deleting account records', () => {
        service.recordAccounts('a', []);
        expect(service.all()).toHaveLength(3);
        expect(service.byId().get(1)?.active).toBe(false);
        expect(service.byId().get(2)?.active).toBe(false);
        expect(service.byId().get(3)?.active).toBe(true);
    });

    it('preserves status when absent, but honors explicit deactivation and reactivation', () => {
        service.recordAccounts('a', [broker(1, false), broker(2)]);
        const { active: _, ...noStatus } = broker(1);
        const normalized = service.recordAccounts('a', [noStatus as TradovateAccount, broker(2)]);
        expect(normalized[0].active).toBe(false);
        service.recordBalances('a', [{ accountId: 1, amount: 47000 } as TradovateCashBalance]);
        expect(service.byId().get(1)?.active).toBe(false);
        service.recordAccounts('a', [broker(1), broker(2)]);
        expect(service.byId().get(1)?.active).toBe(true);
        expect(service.byId().get(1)?.lastBalance).toBe(47000);
        expect(service.byId().get(1)?.startingBalance).toBe(50000);
    });

    it.each([null, {}, [broker(1), { id: 2 }], [broker(1), broker(1)], [{ ...broker(1), active: 'false' }]])(
        'rejects invalid/partial snapshots before changing any metadata: %j', payload => {
            const before = service.all();
            expect(() => service.recordAccounts('a', payload as TradovateAccount[])).toThrow('Invalid account list');
            expect(service.all()).toEqual(before); expect(upsert).not.toHaveBeenCalled();
        });
});
