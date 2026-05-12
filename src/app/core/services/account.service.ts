import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateAccount } from './tradovate.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';

const STORAGE_KEY = 'tradovate_selected_account_ids';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private tradovateService = inject(TradovateService);
    private filterService = inject(FilterService);
    private syncService = inject(SyncService);

    accounts = signal<TradovateAccount[]>([]);
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
            const valid = stored.filter(id => accounts.some(a => a.id === id));
            const resolved = valid.length > 0 ? valid : accounts.map(a => a.id);
            this.selectedIds.set(resolved);
            this.saveSelectedIds(resolved);
        });

        // Push account selection into FilterService whenever it changes.
        effect(() => {
            const ids = this.selectedIds();
            const total = this.accounts().length;
            if (total === 0 || ids.length === 0 || ids.length === total) {
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
