import { Injectable, inject, signal, computed, isDevMode, effect, untracked } from '@angular/core';
import { firstValueFrom, fromEvent } from 'rxjs';
import { takeUntil, timeout } from 'rxjs/operators';
import { TradovateAccountReport, TradovateService } from './tradovate.service';
import { TradeService } from './trade.service';
import { AccountSettingsService } from './account-settings.service';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { reconcileBrokerTrades } from '../utils/broker-trade-identity';
import { AccessPolicyService } from './access-policy.service';
import { AccountSyncResult, BrokerAccountTarget, brokerAccountKey, parsePendingSync } from '../../features/integrations/sync-status/broker-sync.model';
import { BrokerSyncHistoryService } from '../../features/integrations/sync-status/broker-sync-history.service';
import { readCache } from './user-data/user-data.cache';

export interface SyncLogEntry {
    time: string;
    message: string;
    type: 'info' | 'success' | 'warn' | 'error';
}

@Injectable({ providedIn: 'root' })
export class SyncService {
    private broker = inject(TradovateService);
    private trades = inject(TradeService);
    private settings = inject(AccountSettingsService);
    private session = inject(UserSessionService);
    private repo = inject(UserDataRepo);
    private access = inject(AccessPolicyService);
    private history = inject(BrokerSyncHistoryService);
    private static readonly LAST_SYNC_KEY = 'tradovate_last_sync_time';
    private static readonly RETRY_KEY = 'tradovate_pending_sync';

    readonly isSyncing = signal(false);
    readonly lastSyncTime = signal<Date | null>(null);
    readonly syncLog = signal<SyncLogEntry[]>([]);
    readonly syncProgress = signal<{ current: number; total: number } | null>(null);
    readonly syncWarning = signal<string | null>(null);
    readonly lastError = signal<string | null>(null);
    readonly lastResult = signal<number | null>(null);
    readonly retryStateWarning = signal(false);
    private readonly results = signal<AccountSyncResult[]>([]);
    private readonly resultsOwner = signal<string | null>(null);
    readonly accountResults = computed(() => this.resultsOwner() === this.session.userId() && !this.access.demo()
        ? this.results() : []);
    readonly retryableAccounts = computed(() => {
        const eligible = new Set(this.eligibleAccounts().map(brokerAccountKey));
        return this.accountResults().filter(r => (r.state === 'failed' || r.state === 'cancelled') && eligible.has(brokerAccountKey(r)));
    });
    private retryRange: { owner: string; from: Date | null; to: Date } | null = null;
    private activeRun: AbortController | null = null;
    private context = '';

    constructor() {
        this.context = JSON.stringify([this.session.userId(), this.access.demo()]);
        this.resultsOwner.set(this.session.userId());
        this.lastSyncTime.set(this.access.demo() ? null : SyncService.loadLastSyncTime(this.session.userId()));
        this.restoreRetries(this.access.demo() ? null : this.session.userId());
        effect(() => {
            const owner = this.session.userId(), demo = this.access.demo();
            const context = JSON.stringify([owner, demo]);
            if (context === this.context) return;
            this.context = context;
            untracked(() => {
                this.activeRun?.abort();
                this.lastSyncTime.set(demo ? null : SyncService.loadLastSyncTime(owner));
                this.resultsOwner.set(owner);
                this.results.set([]);
                this.retryRange = null;
                this.restoreRetries(demo ? null : owner);
                this.lastError.set(null);
                this.lastResult.set(null);
                this.clearLog();
            });
        });
    }

    cancelSync(): void { this.activeRun?.abort(); }

    private static loadLastSyncTime(userId: string | null): Date | null {
        if (!userId) return null;
        try {
            const stored = localStorage.getItem(SyncService.LAST_SYNC_KEY + ':' + userId);
            const date = stored ? new Date(stored) : null;
            return date && Number.isFinite(date.getTime()) ? date : null;
        } catch { return null; }
    }

    private log(message: string, type: SyncLogEntry['type'] = 'info'): void {
        this.syncLog.update(logs => [...logs, { time: new Date().toLocaleTimeString(), message, type }]);
        if (isDevMode()) console.log('[SyncService] ' + message);
    }

    clearLog(): void {
        this.syncLog.set([]);
        this.syncProgress.set(null);
        this.syncWarning.set(null);
        this.lastError.set(null);
        this.lastResult.set(null);
        // Clearing a text log must not discard failed-account retry context.
    }

    fullSync(): Promise<number> { return this.syncFrom(null); }

    syncTrades(): Promise<number> {
        const from = new Date(this.lastSyncTime()
            ? this.lastSyncTime()!.getTime() - 86_400_000 : Date.now() - 365 * 86_400_000);
        return this.syncFrom(from);
    }

    syncFrom(from: Date | null): Promise<number> { return this.run(from, new Date()); }

    retryFailedAccounts(): Promise<number> {
        if (this.isSyncing()) return Promise.resolve(0);
        this.access.assertAction('sync');
        const range = this.retryRange, targets = this.retryableAccounts();
        if (!range || range.owner !== this.session.userId() || !targets.length) {
            return Promise.reject(new Error('No connected failed accounts to retry. Reconnect the broker or start a new import.'));
        }
        return this.run(range.from, range.to, targets);
    }

    private eligibleAccounts() {
        return this.broker.connections().flatMap(conn => conn.accounts.filter(a => a.active !== false)
            .map(a => ({ connectionId: conn.id, accountId: a.id, accountName: a.name })));
    }

    private setResult(target: BrokerAccountTarget, patch: Partial<AccountSyncResult>): void {
        const key = brokerAccountKey(target);
        this.results.update(rows => rows.map(r => brokerAccountKey(r) === key ? { ...r, ...patch } : r));
        this.persistRetries();
    }

    private restoreRetries(owner: string | null): void {
        const pending = owner ? parsePendingSync(readCache(SyncService.RETRY_KEY + ':' + owner)) : [];
        this.results.set(pending);
        this.retryStateWarning.set(false);
        this.retryRange = owner && pending.length ? { owner,
            from: pending[0].fromDate ? new Date(pending[0].fromDate) : null, to: new Date(pending[0].toDate) } : null;
    }

    private persistRetries(): void {
        if (this.access.demo() || !this.session.userId() || this.resultsOwner() !== this.session.userId()) return;
        try {
            localStorage.setItem(SyncService.RETRY_KEY + ':' + this.session.userId(),
                JSON.stringify(this.accountResults().filter(r => r.state !== 'synced')));
            this.retryStateWarning.set(false);
        } catch { this.retryStateWarning.set(true); }
    }

    private async run(fromDate: Date | null, endDate: Date, targets?: readonly BrokerAccountTarget[]): Promise<number> {
        this.access.assertAction('sync');
        if (this.isSyncing()) return 0;
        if (fromDate && (!Number.isFinite(fromDate.getTime()) || fromDate > endDate)) {
            const message = 'Choose a valid import date that is not in the future.';
            this.lastError.set(message);
            this.lastResult.set(null);
            throw new Error(message);
        }
        const scope = this.access.capture(), run = new AbortController();
        const signal = AbortSignal.any([scope.signal, run.signal]);
        this.activeRun = run;
        const assertRun = () => {
            this.access.assertCurrent(scope);
            this.access.assertAction('sync');
            if (run.signal.aborted) throw new Error('Sync cancelled. Saved history was kept.');
        };
        const selected = targets ? new Set(targets.map(brokerAccountKey)) : null;
        const previous = new Map(this.accountResults().map(r => [brokerAccountKey(r), r]));
        const planned = this.eligibleAccounts().filter(a => !selected || selected.has(brokerAccountKey(a))).map(a => {
            const pending = previous.get(brokerAccountKey(a));
            let from = fromDate;
            let to = endDate;
            if (pending && (pending.state === 'failed' || pending.state === 'cancelled')) {
                const olderFrom = pending.fromDate ? new Date(pending.fromDate) : null;
                // Never let a short background refresh erase an unresolved older range.
                if (targets || !olderFrom || (from && olderFrom < from)) from = olderFrom;
                if (targets) to = new Date(pending.toDate);
            }
            return { ...a, fromDate: from, toDate: to };
        });
        const keys = new Set(planned.map(brokerAccountKey));
        this.resultsOwner.set(scope.userId);
        this.results.set([
            ...(targets ? this.accountResults().filter(r => !keys.has(brokerAccountKey(r))) : []),
            ...planned.map(a => ({ ...a, fromDate: a.fromDate?.toISOString() ?? null, toDate: a.toDate.toISOString(),
                state: 'fetching' as const, message: 'Fetching report…', imported: 0 })),
        ]);
        this.retryRange = { owner: scope.userId, from: fromDate ? new Date(fromDate) : null, to: new Date(endDate) };
        this.persistRetries();
        this.isSyncing.set(true);
        this.clearLog();
        this.lastError.set(null);
        this.lastResult.set(null);
        let imported = 0;
        try {
            if (!planned.length) throw new Error('No active broker accounts are available to sync. Saved history is unchanged.');
            const conns = this.broker.connections();
            this.log((targets ? 'Retrying ' : 'Syncing ') + planned.length + ' account(s) ' +
                (fromDate ? 'from ' + fromDate.toLocaleDateString() : 'from account start') + '.');
            const reports = await firstValueFrom(this.broker.getAccountTradeReports(fromDate, endDate, planned).pipe(
                timeout(5 * 60_000), takeUntil(fromEvent(signal, 'abort')),
            ));
            assertRun();
            if (!reports.length) throw new Error('No active broker accounts are available to sync. Saved history is unchanged.');
            let completed = 0;
            this.syncProgress.set({ current: 0, total: planned.length });
            for (const target of planned) {
                assertRun();
                const report = reports.find(r => brokerAccountKey(r) === brokerAccountKey(target));
                let stage: 'report' | 'review' | 'save' | 'receipt' = 'report';
                try {
                    if (!report) throw new Error('No complete report received. Retry this account.');
                    if (report.error) throw new Error(report.error);
                    if (!this.eligibleAccounts().some(a => brokerAccountKey(a) === brokerAccountKey(target))) {
                        throw new Error('Account is no longer connected. Saved history was kept.');
                    }
                    stage = 'review';
                    const prepared = this.prepareTrades(report);
                    this.setResult(target, { state: 'saving', message: 'Saving trades…' });
                    stage = 'save';
                    this.trades.backfillConnectionIds(target.connectionId, new Set([String(target.accountId)]));
                    if (prepared.feeUpdates.length) this.trades.patchTradesFees(prepared.feeUpdates);
                    for (const trade of prepared.newTrades) this.trades.createTrade(trade, scope.userId);
                    await this.repo.flushQueue();
                    assertRun();
                    stage = 'receipt';
                    await this.history.record(target, target.fromDate, target.toDate, scope);
                    assertRun();
                    imported += prepared.newTrades.length;
                    completed++;
                    this.setResult(target, { state: 'synced', imported: prepared.newTrades.length,
                        message: report.trades.length ? prepared.newTrades.length + ' new trade(s). Saved to your account.' : 'No completed trades in this range. Report checked.' });
                    this.log(target.accountName + ': synced (' + prepared.newTrades.length + ' new trades).', 'success');
                } catch (err) {
                    assertRun(); // Cancellation/owner changes are never ordinary account failures.
                    const message = stage === 'save' ? 'Could not save trades to your account. Local changes are queued; retry when online.'
                        : err instanceof Error ? err.message : 'Could not sync this account. Please retry.';
                    this.setResult(target, { state: 'failed', message });
                    this.log((conns.find(c => c.id === target.connectionId)?.name ?? 'Broker') + ' / ' + target.accountName + ': ' + message + ' Saved history kept.', 'error');
                }
                this.syncProgress.update(p => p ? { ...p, current: p.current + 1 } : p);
            }
            const results = this.accountResults();
            if (!completed) {
                const first = results.find(r => keys.has(brokerAccountKey(r)) && r.state === 'failed');
                throw new Error('No accounts synced. ' + (first?.accountName ?? '') + ': ' + (first?.message ?? 'Please retry.'));
            }
            const succeeded = new Set(results.filter(r => r.state === 'synced').map(brokerAccountKey));
            const eligible = this.eligibleAccounts();
            for (const conn of conns) {
                const accounts = eligible.filter(a => a.connectionId === conn.id);
                if (accounts.length && accounts.every(a => succeeded.has(brokerAccountKey(a)))) this.broker.updateConnectionSyncTime(conn.id);
            }
            await this.repo.flushQueue();
            assertRun();
            if (eligible.length && eligible.every(a => succeeded.has(brokerAccountKey(a)))) {
                // Use the request end, NOT completion time: delayed retries must
                // not skip trades entered while the user was waiting to retry.
                const checkpoint = new Date(Math.min(...eligible.map(a => Date.parse(
                    results.find(r => brokerAccountKey(r) === brokerAccountKey(a))!.toDate))));
                this.lastSyncTime.set(checkpoint);
                try { localStorage.setItem(SyncService.LAST_SYNC_KEY + ':' + scope.userId, checkpoint.toISOString()); }
                catch { this.syncWarning.set('Trades saved, but this browser couldn’t remember the incremental sync date. The next sync may recheck older trades.'); }
                this.log('Done! Imported ' + imported + ' trade(s).', 'success');
            } else {
                const warning = 'Partial sync: ' + results.filter(r => r.state === 'synced').length + ' of ' +
                    results.length + ' accounts synced. Saved history was kept. Retry failed accounts below.';
                this.syncWarning.set(warning);
                this.log(warning, 'warn');
            }
            this.lastResult.set(imported);
            return imported;
        } catch (err) {
            const message = run.signal.aborted ? 'Sync cancelled. Saved history was kept.'
                : err instanceof Error ? err.message : 'Sync failed. Please retry.';
            if (this.access.isCurrent(scope)) {
                for (const target of planned) {
                    const state = this.accountResults().find(r => brokerAccountKey(r) === brokerAccountKey(target))?.state;
                    if (state === 'fetching' || state === 'saving') this.setResult(target, {
                        state: run.signal.aborted ? 'cancelled' : 'failed', message,
                    });
                }
                this.lastError.set(message);
                this.log(message, 'error');
            }
            throw new Error(message);
        } finally {
            if (this.activeRun === run) {
                this.activeRun = null;
                this.isSyncing.set(false);
                this.syncProgress.set(null);
            }
        }
    }

    private prepareTrades(report: TradovateAccountReport) {
        const commission = this.settings.commissionPerContract();
        const matched = report.trades.map(t => {
            const fees = t.fees ?? Number((commission * t.quantity * 2).toFixed(2));
            return { ...t, fees, netPnl: Number((t.pnl - fees).toFixed(2)), source: 'tradovate' as const };
        });
        const reconciliation = reconcileBrokerTrades(matched, this.trades.trades());
        if (reconciliation.review.length) throw new Error(reconciliation.review.length +
            ' possible cross-format duplicate(s). Review these trades before retrying. No trades were removed.');
        const feeUpdates: { id: string; fees: number; netPnl: number }[] = [];
        for (const trade of matched) {
            const existing = reconciliation.matches.get(trade);
            if (existing && (existing.fees !== trade.fees || existing.netPnl !== trade.netPnl)) {
                feeUpdates.push({ id: existing.id, fees: trade.fees, netPnl: trade.netPnl });
            }
        }
        return { newTrades: reconciliation.newTrades, feeUpdates };
    }
}
