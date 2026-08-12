import { Injectable, computed, inject, signal, effect, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateAccount, TradovateConnection } from './tradovate.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';
import { TradeService } from './trade.service';
import { TradingAccountsService } from './trading-accounts.service';
import { isCacheSuspended } from './user-data/user-data.cache';

const STORAGE_KEY = 'tradovate_selected_account_ids';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private tradovateService = inject(TradovateService);
    private filterService = inject(FilterService);
    private syncService = inject(SyncService);
    private tradeService = inject(TradeService);
    private tradingAccounts = inject(TradingAccountsService);

    accounts = signal<TradovateAccount[]>([]);
    inactiveAccounts = computed(() => this.tradovateService.inactiveAccounts());

    // Accounts that are NOT part of any live connection but still exist for
    // this user. Primary source: the persisted trading_accounts store (kept
    // on disconnect, with stored name/type). Fallback: skeletons rebuilt from
    // trade rows, for trades whose account never got a stored row.
    historicalAccounts = computed((): TradovateAccount[] => {
        const liveIds = new Set([
            ...this.accounts().map(a => a.id),
            ...this.inactiveAccounts().map(a => a.id)
        ]);
        const seen = new Set<number>();
        const result: TradovateAccount[] = [];

        for (const acc of this.tradingAccounts.all()) {
            if (liveIds.has(acc.accountId) || seen.has(acc.accountId)) continue;
            seen.add(acc.accountId);
            result.push({
                id: acc.accountId,
                name: acc.name || String(acc.accountId),
                userId: 0,
                accountType: acc.accountType,
                active: false
            });
        }

        for (const t of this.tradeService.trades()) {
            if (!t.accountId || t.accountId === '0') continue;
            const id = Number(t.accountId);
            if (isNaN(id) || liveIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            result.push({ id, name: t.accountName || t.accountId, userId: 0, accountType: '', active: false });
        }
        return result;
    });

    selectedIds = signal<number[]>(this.loadSelectedIds());

    // Balances fetched from the Tradovate API this session.
    private liveBalances = signal<Map<number, number>>(new Map());

    // Connections whose last balance fetch failed — used to surface staleness hints.
    balanceFailedConnectionIds = signal<Set<string>>(new Set());

    isRefreshing = signal(false);
    isConnected = computed(() => this.tradovateService.isConnected());

    /**
     * accountId → balance for every known account: stored last-known balances
     * as the base, overlaid by fresh API balances. Historical/disconnected
     * accounts keep contributing their last_balance instead of dropping to 0.
     */
    accountBalances = computed((): Map<number, number> => {
        const merged = new Map(this.tradingAccounts.storedBalances());
        for (const [id, amount] of this.liveBalances()) merged.set(id, amount);
        return merged;
    });

    // Accounts whose balance is from the DB, not refreshed live this session.
    staleBalanceIds = computed((): Set<number> => {
        const live = this.liveBalances();
        const stale = new Set<number>();
        for (const id of this.selectedIds()) {
            if (!live.has(id)) stale.add(id);
        }
        return stale;
    });

    // Aggregated balance for selected accounts; null if no data exists for any of them.
    currentBalance = computed((): number | null => {
        const selected = this.selectedIds();
        if (selected.length === 0) return null;
        const balances = this.accountBalances();
        let total = 0;
        let hasAny = false;
        for (const id of selected) {
            const b = balances.get(id);
            if (b !== undefined) { total += b; hasAny = true; }
        }
        return hasAny ? total : null;
    });

    // 0-fallback alias for components that always want a number.
    aggregatedBalance = computed((): number => this.currentBalance() ?? 0);

    // ISO timestamp of the oldest stale balance among selected accounts — for "as of" hint.
    staleAsOf = computed((): string | null => {
        const stale = this.staleBalanceIds();
        if (stale.size === 0) return null;
        const stored = this.tradingAccounts.byId();
        let oldest: string | null = null;
        for (const id of stale) {
            const ts = stored.get(id)?.balanceUpdatedAt;
            if (!ts) continue;
            if (!oldest || ts < oldest) oldest = ts;
        }
        return oldest;
    });

    constructor() {
        // Reactively sync accounts from all connections whenever any connection's accounts change.
        effect(() => {
            const accounts = this.tradovateService.allAccounts();
            if (accounts.length === 0) {
                // No live accounts. If connections are gone entirely (e.g. the
                // last one was removed), clear the live list so those accounts
                // re-surface as historical instead of appearing still active.
                if (this.tradovateService.connections().length === 0) this.accounts.set([]);
                return;
            }
            this.accounts.set(accounts);

            // Default to ALL accounts only when no selection has ever been made.
            // Once a selection exists, respect it across pages — never reset to all.
            if (!this.hasStoredSelection()) {
                const all = accounts.map(a => a.id);
                this.selectedIds.set(all);
                this.saveSelectedIds(all);
                return;
            }

            // Respect the saved selection; only drop ids that no longer exist
            // anywhere. Never auto-re-add accounts the user deselected.
            const allKnownIds = new Set([
                ...accounts.map(a => a.id),
                ...this.inactiveAccounts().map(a => a.id),
                ...this.historicalAccounts().map(a => a.id)
            ]);
            const pruned = this.loadSelectedIds().filter(id => allKnownIds.has(id));
            if (!this.sameIds(untracked(() => this.selectedIds()), pruned)) {
                this.selectedIds.set(pruned);
                this.saveSelectedIds(pruned);
            }
        });

        // Push account selection into FilterService whenever it changes.
        effect(() => {
            const ids = this.selectedIds();
            const totalKnown = this.accounts().length + this.inactiveAccounts().length + this.historicalAccounts().length;
            if (totalKnown === 0 || ids.length === 0) {
                this.filterService.updateAccounts([]);
            } else {
                this.filterService.updateAccounts(ids.map(id => id.toString()));
            }
        });
    }

    init(): void {
        // Stored balances from TradingAccountsService already render via accountBalances —
        // no need to wait for the API. Just kick off the live refresh.
        if (!this.isConnected()) return;
        const cached = this.tradovateService.allAccounts();
        if (cached.length === 0) {
            Promise.all(
                this.tradovateService.connections().map(conn =>
                    firstValueFrom(this.tradovateService.getAccountsForConnection(conn)).catch(() => null)
                )
            ).then(() => void this.fetchBalances());
        } else {
            void this.fetchBalances();
        }
    }

    private async fetchBalances(): Promise<void> {
        await Promise.all(
            this.tradovateService.connections().map(conn => this.fetchBalancesForConnection(conn))
        );
    }

    private async fetchBalancesForConnection(conn: TradovateConnection): Promise<void> {
        try {
            const balances = await firstValueFrom(
                this.tradovateService.getCashBalancesForConnection(conn)
            );
            this.liveBalances.update(map => {
                const next = new Map(map);
                for (const b of balances) {
                    if (b.accountId && b.amount !== undefined) next.set(b.accountId, b.amount);
                }
                return next;
            });
            this.balanceFailedConnectionIds.update(s => {
                if (!s.has(conn.id)) return s;
                const next = new Set(s);
                next.delete(conn.id);
                return next;
            });
        } catch (err) {
            console.error('[AccountService] Failed to fetch balances for', conn.name, err);
            this.balanceFailedConnectionIds.update(s => {
                if (s.has(conn.id)) return s;
                const next = new Set(s);
                next.add(conn.id);
                return next;
            });
        }
    }

    /** ISO timestamp of the last known balance for an account. */
    balanceUpdatedAt(accountId: number): string | undefined {
        if (this.liveBalances().has(accountId)) return new Date().toISOString();
        return this.tradingAccounts.byId().get(accountId)?.balanceUpdatedAt ?? undefined;
    }

    /** Put a synthetic account into the Active slot — used by demo mode so the
     *  header dropdown shows a live-looking account without touching TradovateService. */
    setDemoLiveAccount(id: number, name: string, accountType: string): void {
        this.accounts.set([{ id, name, userId: 0, accountType, active: true }]);
    }

    /** Re-sync the live accounts list from TradovateService (which was never
     *  touched during demo, so its value is still the real user's data). */
    resetLiveAccounts(): void {
        this.accounts.set(this.tradovateService.allAccounts());
    }

    /** Override selection in-memory without persisting to localStorage.
     *  Used by demo mode so the real user's stored selection is never touched. */
    setSelectionTransient(ids: number[]): void {
        this.selectedIds.set(ids);
    }

    /** Restore selection from localStorage. Called when demo mode exits. */
    restorePersistedSelection(): void {
        this.selectedIds.set(this.loadSelectedIds());
    }

    toggle(id: number): void {
        const next = this.selectedIds().includes(id)
            ? this.selectedIds().filter(x => x !== id)
            : [...this.selectedIds(), id];
        this.selectedIds.set(next);
        if (!isCacheSuspended()) this.saveSelectedIds(next);
    }

    selectAll(): void {
        const all = this.accounts().map(a => a.id);
        this.selectedIds.set(all);
        if (!isCacheSuspended()) this.saveSelectedIds(all);
    }

    deselectAll(): void {
        this.selectedIds.set([]);
        if (!isCacheSuspended()) this.saveSelectedIds([]);
    }

    async refreshBalances(): Promise<void> {
        if (!this.isConnected()) return;
        this.isRefreshing.set(true);
        try {
            const conns = this.tradovateService.connections();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            await Promise.all([
                ...conns.map(conn =>
                    firstValueFrom(this.tradovateService.getAccountsForConnection(conn))
                        .catch(err => console.error('[AccountService] Failed to refresh accounts for', conn.name, err))
                ),
                ...conns.map(conn => this.fetchBalancesForConnection(conn)),
                this.syncService.syncFrom(today)
            ]);
        } catch (err) {
            console.error('[AccountService] Failed to refresh:', err);
        } finally {
            this.isRefreshing.set(false);
        }
    }

    private hasStoredSelection(): boolean {
        return localStorage.getItem(STORAGE_KEY) !== null;
    }

    private sameIds(a: number[], b: number[]): boolean {
        if (a.length !== b.length) return false;
        const setB = new Set(b);
        return a.every(id => setB.has(id));
    }

    private loadSelectedIds(): number[] {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch { return []; }
    }

    private saveSelectedIds(ids: number[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }
}
