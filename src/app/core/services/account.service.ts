import { Injectable, computed, inject, signal, effect, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateAccount, TradovateConnection } from './tradovate.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';
import { TradeService } from './trade.service';
import { TradingAccountsService } from './trading-accounts.service';
import { AccountSettingsService } from './account-settings.service';
import { UserSessionService } from './user-session.service';
import { isCacheSuspended, cacheSuspended } from './user-data/user-data.cache';

const STORAGE_KEY = 'tradovate_selected_account_ids';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private tradovateService = inject(TradovateService);
    private filterService = inject(FilterService);
    private syncService = inject(SyncService);
    private tradeService = inject(TradeService);
    private tradingAccounts = inject(TradingAccountsService);
    private accountSettings = inject(AccountSettingsService);
    private userSession = inject(UserSessionService);

    accounts = signal<TradovateAccount[]>([]);

    // Broker-disabled accounts remain in historical views and import targets.
    // Primary source: stored table rows. Fallback: blob entries not yet stored.
    inactiveAccounts = computed((): TradovateAccount[] => {
        const storedById = this.tradingAccounts.byId();
        const result: TradovateAccount[] = [];
        const seen = new Set<number>();

        for (const acc of this.tradingAccounts.all()) {
            if (acc.active) continue;
            seen.add(acc.accountId);
            result.push({
                id: acc.accountId,
                name: acc.name || String(acc.accountId),
                userId: 0,
                accountType: acc.accountType,
                active: false
            });
        }
        // Blob fallback: inactive accounts not yet in stored table
        for (const conn of this.tradovateService.connections()) {
            for (const a of conn.accounts) {
                if (a.active !== false) continue;
                if (storedById.has(a.id) || seen.has(a.id)) continue;
                seen.add(a.id);
                result.push(a);
            }
        }
        return result;
    });

    // Every stored account absent from the live list remains selectable under
    // "Historical", including broker-disabled and disconnected accounts. Source:
    // the persisted trading_accounts store. Fallback: trade-row skeletons.
    historicalAccounts = computed((): TradovateAccount[] => {
        const liveIds = new Set([
            ...this.accounts().map(a => a.id)
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
            if (!t.accountId || t.accountId === '0') {
                if (!seen.has(0)) { seen.add(0); result.push({ id: 0, name: 'Unassigned / manual trades', userId: 0, accountType: '', active: false }); }
                continue;
            }
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
        for (const id of selected) {
            const b = balances.get(id);
            if (b === undefined) return null;
            total += b;
        }
        return total;
    });

    // 0-fallback alias for components that always want a number.
    aggregatedBalance = computed((): number => this.currentBalance() ?? 0);

    /**
     * The account's OPENING balance — the funded amount before any P&L was realised.
     * This is what equity-curve charts must start from so the curve spans
     * [openingBalance … currentBalance] rather than starting at currentBalance.
     *
     * Resolution order (summed across selected accounts):
     *   a) stored starting_balance from trading_accounts (when every selected
     *      account has one — requires the 0013 migration to be applied and the
     *      value to be explicitly set per account)
     *   b) currentBalance − ΣP&L of ALL closed trades for selected accounts
     *      (correct only when no deposits/withdrawals occurred — prop resets and
     *      payouts will skew this)
     *   c) accountSettings.startingBalance() — the user-configured account size
     */
    openingBalance = computed((): number => {
        const selected = this.selectedIds();

        // (a) Stored per-account starting balances.
        // Only use if ALL selected accounts have one — a partial sum would silently
        // drop accounts and understate the baseline.
        const storedStarts = this.tradingAccounts.storedStartingBalances();
        if (selected.length > 0 && selected.every(id => storedStarts.has(id))) {
            return selected.reduce((sum, id) => sum + storedStarts.get(id)!, 0);
        }

        // (b) Derive from current balance minus all-time P&L.
        const current = this.currentBalance();
        if (current !== null) {
            const selectedSet = new Set(selected.map(id => String(id)));
            const totalPnl = this.tradeService.trades()
                .filter(t =>
                    t.status === 'closed' &&
                    t.netPnl !== undefined &&
                    (selected.length === 0 || (t.accountId != null && selectedSet.has(t.accountId)))
                )
                .reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
            return current - totalPnl;
        }

        // (c) Configured account size.
        return this.accountSettings.startingBalance();
    });

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
        effect(() => {
            this.userSession.userId();
            this.liveBalances.set(new Map());
            this.balanceFailedConnectionIds.set(new Set());
            this.selectedIds.set(this.loadSelectedIds());
        });
        // Derive live accounts from trading_accounts (the authoritative table),
        // not from the blob inside tradovate_connections.data.
        //
        // Live = stored active=true + connectionId in a non-removed/non-disabled connection.
        // Fallback: blob entries whose account row hasn't been written to the table yet.
        //
        // Guarded by cacheSuspended() so demo hydration doesn't overwrite the
        // value set by setDemoLiveAccount() — demo connections are never in
        // tradovateService.connections(), which would otherwise produce an empty live list.
        effect(() => {
            if (cacheSuspended()) return;
            if (!this.userSession.userId()) { this.accounts.set([]); return; }

            const stored = this.tradingAccounts.all();
            const storedById = this.tradingAccounts.byId();
            const liveConnIds = new Set(this.tradovateService.connections().map(c => c.id));

            // Primary: stored accounts that are active and belong to a live connection.
            const live: TradovateAccount[] = [];
            const seenIds = new Set<number>();
            for (const acc of stored) {
                if (!acc.active) continue;
                if (!acc.connectionId || !liveConnIds.has(acc.connectionId)) continue;
                seenIds.add(acc.accountId);
                live.push({
                    id: acc.accountId,
                    name: acc.name || String(acc.accountId),
                    userId: 0,
                    accountType: acc.accountType,
                    active: true
                });
            }
            // Fallback: blob entries not yet in the stored table.
            for (const conn of this.tradovateService.connections()) {
                for (const a of conn.accounts) {
                    if (a.active === false) continue;
                    if (storedById.has(a.id) || seenIds.has(a.id)) continue;
                    seenIds.add(a.id);
                    live.push(a);
                }
            }
            this.accounts.set(live);

            // Default to known accounts (including historical) on a new device.
            if (!this.hasStoredSelection()) {
                const all = [...new Set([...live.map(a => a.id), ...stored.map(a => a.accountId),
                    ...this.tradeService.trades().map(t => Number(t.accountId || 0)).filter(Number.isFinite)])];
                this.selectedIds.set(all);
                if (all.length) this.saveSelectedIds(all);
                return;
            }

            // Prune saved selection: drop IDs that are no longer known or retired.
            // Compute allKnownIds inline to avoid a reactive dependency on
            // this.accounts() or the computed signals that read it.
            const allKnownIds = new Set<number>();
            for (const a of live) allKnownIds.add(a.id);
            // Inactive/retired: stored active=false (still "known" so blob-only accounts not dropped)
            for (const acc of stored) {
                if (!acc.active) allKnownIds.add(acc.accountId);
            }
            // Inactive blob fallback
            for (const conn of this.tradovateService.connections()) {
                for (const a of conn.accounts) {
                    if (a.active === false && !storedById.has(a.id)) allKnownIds.add(a.id);
                }
            }
            // Historical: stored active=true with no live connection
            for (const acc of stored) {
                if (acc.active && (!acc.connectionId || !liveConnIds.has(acc.connectionId))) {
                    allKnownIds.add(acc.accountId);
                }
            }
            // Historical trade-skeleton IDs
            for (const t of this.tradeService.trades()) {
                if (!t.accountId || t.accountId === '0') { allKnownIds.add(0); continue; }
                const id = Number(t.accountId);
                if (!isNaN(id)) allKnownIds.add(id);
            }

            const pruned = this.loadSelectedIds().filter(id => allKnownIds.has(id));
            if (!this.sameIds(untracked(() => this.selectedIds()), pruned)) {
                this.selectedIds.set(pruned);
                // Do not erase a stored selection while another data source is
                // still loading; only explicit selection changes are persisted.
            }
        });

        // Push account selection into FilterService whenever it changes.
        // Historical accounts are selectable, never silently injected into totals.
        effect(() => {
            const ids = this.selectedIds();
            const totalKnown = this.accounts().length + this.inactiveAccounts().length + this.historicalAccounts().length;
            this.filterService.updateAccounts(ids.map(String), totalKnown > 0 || this.hasStoredSelection());
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
        const scope = this.userSession.capture();
        try {
            const balances = await firstValueFrom(
                this.tradovateService.getCashBalancesForConnection(conn)
            );
            this.userSession.assertCurrent(scope);
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
            if (!this.userSession.isCurrent(scope)) return;
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

    /** Called by demo mode on exit after TradingAccountsService is re-hydrated
     *  with real user data. The account-sync effect re-runs automatically when
     *  cacheSuspended flips to false, so no explicit derivation is needed here. */
    resetLiveAccounts(): void { }

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
        const all = [...this.accounts(), ...this.historicalAccounts()].map(a => a.id);
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
        return localStorage.getItem(`${STORAGE_KEY}:${this.userSession.userId()}`) !== null;
    }

    private sameIds(a: number[], b: number[]): boolean {
        if (a.length !== b.length) return false;
        const setB = new Set(b);
        return a.every(id => setB.has(id));
    }

    private loadSelectedIds(): number[] {
        try {
            const stored = localStorage.getItem(`${STORAGE_KEY}:${this.userSession.userId()}`);
            return stored ? JSON.parse(stored) : [];
        } catch { return []; }
    }

    private saveSelectedIds(ids: number[]): void {
        if (this.userSession.userId()) localStorage.setItem(`${STORAGE_KEY}:${this.userSession.userId()}`, JSON.stringify(ids));
    }
}
