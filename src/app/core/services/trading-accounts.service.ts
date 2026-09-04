import { Injectable, computed, inject, signal } from '@angular/core';
import type { TradovateAccount, TradovateCashBalance } from './tradovate.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { StoredTradingAccount } from './user-data/user-data.mappers';
import { CACHE_KEYS, readCache, writeCache } from './user-data/user-data.cache';

/**
 * Permanent record of every trading account the user has ever synced, with its
 * last-known balance (public.trading_accounts). Connections are transient —
 * tokens expire, users disconnect — but these rows are NEVER deleted, so
 * accounts from removed connections keep rendering everywhere (header
 * selector, dashboard, journal and calendar charts) as "historical".
 *
 * Write path: TradovateService records every successful account/balance fetch
 * here. Rows are merged into the in-memory map first and queued as FULL rows
 * through UserDataRepo's micro-batching/offline queue — so a balance-only
 * fetch can never null out a stored name, and vice versa.
 *
 * Read path: UserDataService hydrates from Supabase on login (localStorage
 * cache keeps it warm offline); AccountService merges this store under live
 * API data.
 */
@Injectable({ providedIn: 'root' })
export class TradingAccountsService {
    private repo = inject(UserDataRepo);

    // Starts from the offline cache; UserDataService replaces this with the
    // authoritative Supabase rows once the post-login fetch completes.
    private accountsMap = signal<Map<number, StoredTradingAccount>>(
        TradingAccountsService.toMap(readCache<StoredTradingAccount[]>(CACHE_KEYS.tradingAccounts) ?? [])
    );

    /** All persisted accounts, in stable account-id order. */
    readonly all = computed(() =>
        [...this.accountsMap().values()].sort((a, b) => a.accountId - b.accountId)
    );

    /** accountId → last-known balance, for accounts that ever reported one. */
    readonly storedBalances = computed(() => {
        const map = new Map<number, number>();
        for (const acc of this.accountsMap().values()) {
            if (acc.lastBalance !== null) map.set(acc.accountId, acc.lastBalance);
        }
        return map;
    });

    /** accountId → stored opening balance, for accounts where it has been set. */
    readonly storedStartingBalances = computed(() => {
        const map = new Map<number, number>();
        for (const acc of this.accountsMap().values()) {
            if (acc.startingBalance !== null) map.set(acc.accountId, acc.startingBalance);
        }
        return map;
    });

    /** accountId → full record, for fast lookups. */
    readonly byId = computed(() => new Map(this.accountsMap()));

    /** Account IDs where active = false — retired by the broker or by the user. */
    readonly retiredIds = computed(() => {
        const ids = new Set<number>();
        for (const acc of this.accountsMap().values()) {
            if (!acc.active) ids.add(acc.accountId);
        }
        return ids;
    });

    /** Replace the store with the authoritative cloud rows (or [] on sign-out). */
    hydrate(rows: StoredTradingAccount[]): void {
        this.accountsMap.set(TradingAccountsService.toMap(rows));
        writeCache(CACHE_KEYS.tradingAccounts, rows);
    }

    /** Persist account metadata from an /account/list fetch. Balance and
     *  starting_balance are preserved; active is written from the broker payload
     *  so broker-deactivated accounts are correctly reflected in the stored table. */
    recordAccounts(connectionId: string, accounts: TradovateAccount[]): void {
        if (accounts.length === 0) return;
        this.merge(accounts.map(a => {
            const prev = this.accountsMap().get(a.id);
            return {
                accountId: a.id,
                connectionId,
                name: a.name,
                accountType: a.accountType ?? '',
                active: a.active !== false,
                lastBalance: prev?.lastBalance ?? null,
                balanceUpdatedAt: prev?.balanceUpdatedAt ?? null,
                startingBalance: prev?.startingBalance ?? null,
            };
        }));
    }

    /** Persist balances from a /cashBalance/list fetch. All other fields preserved. */
    recordBalances(connectionId: string, balances: TradovateCashBalance[]): void {
        const now = new Date().toISOString();
        const updates: StoredTradingAccount[] = [];
        for (const b of balances) {
            if (!b.accountId || b.amount === undefined) continue;
            const prev = this.accountsMap().get(b.accountId);
            updates.push({
                accountId: b.accountId,
                connectionId: prev?.connectionId ?? connectionId,
                name: prev?.name ?? '',
                accountType: prev?.accountType ?? '',
                active: prev?.active ?? true,
                lastBalance: b.amount,
                balanceUpdatedAt: now,
                startingBalance: prev?.startingBalance ?? null,
            });
        }
        this.merge(updates);
    }

    /** Retire or restore an account. active=false → excluded from selector and
     *  balance aggregation; trades remain fully visible. */
    setActive(accountId: number, active: boolean): void {
        const prev = this.accountsMap().get(accountId);
        if (!prev || prev.active === active) return;
        this.merge([{ ...prev, active }]);
    }

    private merge(updates: StoredTradingAccount[]): void {
        if (updates.length === 0) return;
        this.accountsMap.update(map => {
            const next = new Map(map);
            updates.forEach(u => next.set(u.accountId, u));
            return next;
        });
        writeCache(CACHE_KEYS.tradingAccounts, [...this.accountsMap().values()]);
        this.repo.queueTradingAccountUpserts(updates);
    }

    private static toMap(rows: StoredTradingAccount[]): Map<number, StoredTradingAccount> {
        return new Map(rows.map(r => [r.accountId, r]));
    }
}
