import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateAccount } from './tradovate.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';
import { TradeService } from './trade.service';

const STORAGE_KEY = 'tradovate_selected_account_ids';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private tradovateService = inject(TradovateService);
    private filterService = inject(FilterService);
    private syncService = inject(SyncService);
    private tradeService = inject(TradeService);

    accounts = signal<TradovateAccount[]>([]);
    inactiveAccounts = computed(() => this.tradovateService.inactiveAccounts());

    // Accounts derived from trade history that are not in active or inactive Tradovate connection lists.
    // Covers accounts that were removed from all connections but still have saved trades.
    historicalAccounts = computed((): TradovateAccount[] => {
        const knownIds = new Set([
            ...this.accounts().map(a => a.id),
            ...this.inactiveAccounts().map(a => a.id)
        ]);
        const seen = new Set<number>();
        const result: TradovateAccount[] = [];
        for (const t of this.tradeService.trades()) {
            if (!t.accountId || t.accountId === '0') continue;
            const id = Number(t.accountId);
            if (isNaN(id) || knownIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            result.push({ id, name: t.accountName || t.accountId, userId: 0, accountType: '', active: false });
        }
        return result;
    });
    selectedIds = signal<number[]>(this.loadSelectedIds());
    accountBalances = signal<Map<number, number>>(new Map());
    isRefreshing = signal(false);

    isConnected = computed(() => this.tradovateService.isConnected());

    aggregatedBalance = computed(() => {
        const selected = this.selectedIds();
        const balances = this.accountBalances();
        return selected.reduce((total, id) => total + (balances.get(id) || 0), 0);
    });

    constructor() {
        // Reactively sync accounts from all connections whenever any connection's accounts change.
        effect(() => {
            const accounts = this.tradovateService.allAccounts();
            if (accounts.length === 0) return;
            this.accounts.set(accounts);
            const stored = this.loadSelectedIds();
            // Allow stored IDs from active, inactive, or historical (trade-derived) accounts
            const allKnownIds = new Set([
                ...accounts.map(a => a.id),
                ...this.inactiveAccounts().map(a => a.id),
                ...this.historicalAccounts().map(a => a.id)
            ]);
            const valid = stored.filter(id => allKnownIds.has(id));
            const resolved = valid.length > 0 ? valid : accounts.length > 0 ? [accounts[0].id] : [];
            this.selectedIds.set(resolved);
            this.saveSelectedIds(resolved);
        });

        // Push account selection into FilterService whenever it changes.
        // Always pass explicit IDs so trades from inactive/old accounts are never shown
        // when only specific accounts are selected. Only skip the filter when no accounts
        // are loaded yet or none are selected (show all / manual trades fall through).
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
        if (!this.isConnected()) return;
        const cached = this.tradovateService.allAccounts();
        if (cached.length === 0) {
            // Accounts not cached yet — fetch from API, then load balances
            Promise.all(
                this.tradovateService.connections().map(conn =>
                    firstValueFrom(this.tradovateService.getAccountsForConnection(conn)).catch(() => null)
                )
            ).then(() => this.fetchBalances());
        } else {
            // Accounts already in cache — just load balances
            this.fetchBalances();
        }
    }

    private async fetchBalances(): Promise<void> {
        const conns = this.tradovateService.connections();
        await Promise.all(
            conns.map(conn =>
                firstValueFrom(this.tradovateService.getCashBalancesForConnection(conn))
                    .then(balances => {
                        this.accountBalances.update(map => {
                            const next = new Map(map);
                            (balances as any[]).forEach(b => {
                                if (b.accountId && b.amount !== undefined) next.set(b.accountId, b.amount);
                            });
                            return next;
                        });
                    }).catch(() => {})
            )
        );
    }

    toggle(id: number): void {
        const next = this.selectedIds().includes(id)
            ? this.selectedIds().filter(x => x !== id)
            : [...this.selectedIds(), id];
        this.selectedIds.set(next);
        this.saveSelectedIds(next);
    }

    selectAll(): void {
        const all = this.accounts().map(a => a.id);
        this.selectedIds.set(all);
        this.saveSelectedIds(all);
    }

    deselectAll(): void {
        this.selectedIds.set([]);
        this.saveSelectedIds([]);
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
                ...conns.map(conn =>
                    firstValueFrom(this.tradovateService.getCashBalancesForConnection(conn))
                        .then(balances => {
                            this.accountBalances.update(map => {
                                const next = new Map(map);
                                (balances as any[]).forEach(b => {
                                    if (b.accountId && b.amount !== undefined) next.set(b.accountId, b.amount);
                                });
                                return next;
                            });
                        }).catch((err) => console.error('[AccountService] Failed to fetch balances for', conn.name, err))
                ),
                this.syncService.syncFrom(today)
            ]);
        } catch (err) {
            console.error('[AccountService] Failed to refresh:', err);
        } finally {
            this.isRefreshing.set(false);
        }
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
