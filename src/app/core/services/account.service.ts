import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateAccount } from './tradovate.service';
import { FilterService } from './filter.service';

const STORAGE_KEY = 'tradovate_selected_account_ids';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private tradovateService = inject(TradovateService);
    private filterService = inject(FilterService);

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
        // Push account selection into FilterService whenever it changes.
        // All selected (or none) → empty array = no account filter.
        // Partial selection → filter to only those account IDs.
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

        this.tradovateService.getAccounts().subscribe({
            next: (accounts) => {
                this.accounts.set(accounts);

                // Restore from localStorage; validate against actual account list
                const stored = this.loadSelectedIds();
                const valid = stored.filter(id => accounts.some(a => a.id === id));
                const resolved = valid.length > 0 ? valid : accounts.map(a => a.id);
                this.selectedIds.set(resolved);
                this.saveSelectedIds(resolved);

                this.refreshBalances();
            },
            error: (err) => console.error('[AccountService] Failed to load accounts:', err)
        });
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
            const balances = await firstValueFrom(this.tradovateService.getCashBalances());
            const map = new Map<number, number>();
            (balances as any[]).forEach(b => {
                if (b.accountId && b.amount !== undefined) map.set(b.accountId, b.amount);
            });
            this.accountBalances.set(map);
        } catch (err) {
            console.error('[AccountService] Failed to refresh balances:', err);
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
