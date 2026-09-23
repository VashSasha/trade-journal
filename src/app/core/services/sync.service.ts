import { Injectable, inject, signal, isDevMode, effect } from '@angular/core';
import { TradovateService } from './tradovate.service';
import { TradeService } from './trade.service';
import { AccountSettingsService } from './account-settings.service';
import { firstValueFrom, Subject, fromEvent } from 'rxjs';
import { takeUntil, timeout } from 'rxjs/operators';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { reconcileBrokerTrades } from '../utils/broker-trade-identity';
import { AccessPolicyService } from './access-policy.service';

export interface SyncLogEntry {
    time: string;
    message: string;
    type: 'info' | 'success' | 'warn' | 'error';
}

@Injectable({
    providedIn: 'root'
})
export class SyncService {
    private tradovateService = inject(TradovateService);
    private tradeService = inject(TradeService);
    private accountSettings = inject(AccountSettingsService);
    private userSession = inject(UserSessionService);
    private repo = inject(UserDataRepo);
    private access = inject(AccessPolicyService);

    private static readonly LAST_SYNC_KEY = 'tradovate_last_sync_time';
    private static readonly SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    isSyncing = signal(false);
    lastSyncTime = signal<Date | null>(null);
    syncLog = signal<SyncLogEntry[]>([]);
    syncProgress = signal<{ current: number; total: number } | null>(null);
    syncWarning = signal<string | null>(null);

    private cancel$ = new Subject<void>();
    private activeRun: AbortController | null = null;
    constructor() {
        effect(() => {
            this.lastSyncTime.set(SyncService.loadLastSyncTime(this.userSession.userId()));
            this.clearLog();
        });
    }

    cancelSync(): void {
        this.activeRun?.abort();
        this.cancel$.next();
        this.log('Sync cancelled by user.', 'warn');
    }

    private static loadLastSyncTime(userId: string | null): Date | null {
        if (!userId) return null;
        const stored = localStorage.getItem(`${SyncService.LAST_SYNC_KEY}:${userId}`);
        if (!stored) return null;
        const d = new Date(stored);
        return isNaN(d.getTime()) ? null : d;
    }

    private log(message: string, type: SyncLogEntry['type'] = 'info'): void {
        const entry: SyncLogEntry = {
            time: new Date().toLocaleTimeString(),
            message,
            type
        };
        this.syncLog.update(logs => [...logs, entry]);
        if (isDevMode()) { console.log(`[SyncService] ${message}`); }
    }

    clearLog(): void {
        this.syncLog.set([]);
        this.syncProgress.set(null);
        this.syncWarning.set(null);
    }

    /**
     * Full sync — fetches all historical data from each account's creation date
     */
    async fullSync(): Promise<number> {
        return this.syncFrom(null);
    }

    /**
     * Incremental sync — uses last sync time or 1 year ago as fallback
     */
    async syncTrades(): Promise<number> {
        const fromDate = this.lastSyncTime()
            ? new Date(this.lastSyncTime()!.getTime() - 24 * 60 * 60 * 1000)
            : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        return this.syncFrom(fromDate);
    }

    /**
     * Sync from a specific date (null = account creation date = full sync)
     */
    async syncFrom(fromDate: Date | null): Promise<number> {
        this.access.assertAction('sync');
        if (this.isSyncing()) return 0;
        const scope = this.access.capture();
        const run = new AbortController();
        this.activeRun = run;
        const assertRun = () => {
            this.userSession.assertCurrent(scope);
            this.access.assertAction('sync');
            if (run.signal.aborted) throw new Error('Sync cancelled. Pending saves remain safe.');
        };
        this.isSyncing.set(true);
        this.clearLog();

        const rangeLabel = fromDate
            ? `from ${fromDate.toLocaleDateString()}`
            : 'from account start (full sync)';
        this.log(`Starting sync ${rangeLabel}...`);

        try {
            const conns = this.tradovateService.connections();
            if (conns.length === 0) throw new Error('No Tradovate connections found');

            this.log(`Syncing ${conns.length} connection(s): ${conns.map(c => c.name).join(', ')}`);

            // Renew tokens that are close to expiry before starting a long sync
            // so the session can't die halfway through.
            for (const conn of conns) {
                await this.tradovateService.ensureFreshToken(conn.id);
                assertRun();
            }

            // Fetch pre-matched trades from Performance report
            this.log('Fetching trades from Tradovate Performance Report...');
            const reports = await firstValueFrom(
                this.tradovateService.getAccountTradeReports(fromDate).pipe(
                    timeout(SyncService.SYNC_TIMEOUT_MS),
                    takeUntil(this.cancel$),
                    takeUntil(fromEvent(scope.signal, 'abort'))
                )
            );
            assertRun();
            if (!reports.length) throw new Error('No active broker accounts are available to sync. Saved history is unchanged.');
            const failed = reports.filter(report => report.error);
            const successful = reports.filter(report => !report.error);
            for (const report of failed) {
                const connection = conns.find(c => c.id === report.connectionId)?.name ?? 'Broker';
                this.log(`${connection} / ${report.accountName}: ${report.error} Saved history kept; account will be retried.`, 'error');
            }
            if (!successful.length) throw new Error(`No accounts synced. ${failed[0].accountName}: ${failed[0].error}`);
            // Only touch history from accounts whose entire report was validated.
            for (const conn of conns) {
                const accountIds = new Set(successful.filter(r => r.connectionId === conn.id).map(r => String(r.accountId)));
                if (!accountIds.size) continue;
                const linked = this.tradeService.backfillConnectionIds(conn.id, accountIds);
                if (linked > 0) this.log(`Linked ${linked} existing trade(s) to ${conn.name}.`);
            }
            const rawTrades = successful.flatMap(report => report.trades);
            this.log(`Retrieved ${rawTrades.length} trade(s)`, rawTrades.length > 0 ? 'success' : 'warn');

            // Use fees from the Performance report directly.
            // Fall back to the configured commission rate only when the report doesn't include a fees column.
            const commission = this.accountSettings.commissionPerContract();
            const matchedTrades = rawTrades.map(t => {
                const fees = t.fees !== undefined
                    ? t.fees
                    : parseFloat((commission * t.quantity * 2).toFixed(2));
                const netPnl = parseFloat((t.pnl - fees).toFixed(2));
                return { ...t, fees, netPnl, source: 'tradovate' as const };
            });

            // Deduplicate and collect fee updates for already-stored trades
            const reconciliation = reconcileBrokerTrades(matchedTrades, this.tradeService.trades());
            if (reconciliation.review.length) {
                throw new Error(`${reconciliation.review.length} possible cross-format duplicate(s). Sync paused; review the existing trades before importing. No trades were removed.`);
            }
            const tradesToImport = reconciliation.newTrades;
            const feeUpdates: { id: string; fees: number; netPnl: number }[] = [];

            for (const t of matchedTrades) {
                const existing = reconciliation.matches.get(t);

                if (existing) {
                    // Trade already stored — update fees/netPnl if the report gives different values
                    if (existing.fees !== t.fees || existing.netPnl !== t.netPnl) {
                        feeUpdates.push({ id: existing.id, fees: t.fees, netPnl: t.netPnl });
                    }
                }
            }

            this.log(
                `${tradesToImport.length} new trade(s) to import (${matchedTrades.length - tradesToImport.length} already exist)`,
                tradesToImport.length > 0 ? 'info' : 'warn'
            );

            // Apply fee corrections to existing trades from the authoritative report data
            if (feeUpdates.length > 0) {
                this.tradeService.patchTradesFees(feeUpdates);
                this.log(`Updated fees for ${feeUpdates.length} existing trade(s) from report.`, 'info');
            }

            // Import new trades

            this.syncProgress.set({ current: 0, total: tradesToImport.length });
            for (let i = 0; i < tradesToImport.length; i++) {
                this.tradeService.createTrade(tradesToImport[i], scope.userId);
                this.syncProgress.set({ current: i + 1, total: tradesToImport.length });
            }

            await this.repo.flushQueue();
            assertRun();
            // New trades and matched fee patches already contain net P&L. Do not
            // recalculate unrelated/failed-account history during a partial sync.
            for (const conn of conns) {
                if (successful.some(r => r.connectionId === conn.id) && !failed.some(r => r.connectionId === conn.id)) {
                    this.tradovateService.updateConnectionSyncTime(conn.id);
                }
            }
            await this.repo.flushQueue();
            assertRun();
            if (failed.length) {
                const warning = `Partial sync: imported ${tradesToImport.length} new trade(s); ${successful.length} of ${reports.length} accounts synced. ${failed.length} account(s) failed — see the sync log. Their history and last successful sync dates were kept. Retry sync after resolving the errors.`;
                this.syncWarning.set(warning);
                this.log(warning, 'warn');
            } else {
                // A global checkpoint only represents a complete, acknowledged
                // sync. Keep the previous range after partial failures for retries.
                const syncTime = new Date();
                this.lastSyncTime.set(syncTime);
                localStorage.setItem(`${SyncService.LAST_SYNC_KEY}:${scope.userId}`, syncTime.toISOString());
                this.log(`Done! Imported ${tradesToImport.length} trade(s).`, 'success');
            }
            this.syncProgress.set(null);

            return tradesToImport.length;

        } catch (err: any) {
            const msg = run.signal.aborted ? 'Sync cancelled. Saved history was kept.' : err?.message || 'Unknown error';
            if (this.userSession.isCurrent(scope)) this.log(`Sync failed: ${msg}`, 'error');
            console.error('Sync failed', err);
            throw run.signal.aborted ? new Error(msg) : err;
        } finally {
            if (this.activeRun === run) {
                this.activeRun = null;
                this.isSyncing.set(false);
                this.syncProgress.set(null);
            }
        }
    }
}
