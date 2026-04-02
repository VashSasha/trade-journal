import { Injectable, inject, signal } from '@angular/core';
import { TradovateService } from './tradovate.service';
import { TradeService } from './trade.service';
import { AccountSettingsService } from './account-settings.service';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil, timeout } from 'rxjs/operators';
import { AuthService } from './auth.service';

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
    private authService = inject(AuthService);
    private accountSettings = inject(AccountSettingsService);

    private static readonly LAST_SYNC_KEY = 'tradovate_last_sync_time';
    private static readonly SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    isSyncing = signal(false);
    lastSyncTime = signal<Date | null>(SyncService.loadLastSyncTime());
    syncLog = signal<SyncLogEntry[]>([]);
    syncProgress = signal<{ current: number; total: number } | null>(null);

    private cancel$ = new Subject<void>();

    cancelSync(): void {
        this.cancel$.next();
        this.isSyncing.set(false);
        this.log('Sync cancelled by user.', 'warn');
    }

    private static loadLastSyncTime(): Date | null {
        const stored = localStorage.getItem(SyncService.LAST_SYNC_KEY);
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
        console.log(`[SyncService] ${message}`);
    }

    clearLog(): void {
        this.syncLog.set([]);
        this.syncProgress.set(null);
    }

    /**
     * Full sync — fetches all historical data from each account's creation date
     */
    async fullSync(): Promise<number> {
        this.lastSyncTime.set(null);
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
        if (this.isSyncing()) return 0;
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

            // Fetch pre-matched trades from Performance report
            this.log('Fetching trades from Tradovate Performance Report...');
            const rawTrades = await firstValueFrom(
                this.tradovateService.getAllTrades(fromDate).pipe(
                    timeout(SyncService.SYNC_TIMEOUT_MS),
                    takeUntil(this.cancel$)
                )
            );
            this.log(`Retrieved ${rawTrades.length} trade(s)`, rawTrades.length > 0 ? 'success' : 'warn');

            if (rawTrades.length === 0) {
                this.log('No trades found for the selected date range.', 'warn');
                const syncTime = new Date();
                this.lastSyncTime.set(syncTime);
                localStorage.setItem(SyncService.LAST_SYNC_KEY, syncTime.toISOString());
                conns.forEach(c => this.tradovateService.updateConnectionSyncTime(c.id));
                return 0;
            }

            // Apply commission and build final trade objects
            const commission = this.accountSettings.commissionPerContract();
            const matchedTrades = rawTrades.map(t => {
                const fees = parseFloat((commission * t.quantity * 2).toFixed(2));
                const netPnl = parseFloat((t.pnl - fees).toFixed(2));
                return {
                    ...t,
                    fees,
                    netPnl,
                    source: 'tradovate' as const,
                    // connectionId is already embedded per-trade from getAllTrades()
                };
            });

            // Deduplicate
            const existingByExternalId = new Map(
                this.tradeService.trades()
                    .filter(t => t.source === 'tradovate' && t.externalId)
                    .map(t => [t.externalId, t])
            );

            const tradesToImport = matchedTrades.filter(t => !existingByExternalId.has(t.externalId));
            this.log(
                `${tradesToImport.length} new trade(s) to import (${matchedTrades.length - tradesToImport.length} already exist)`,
                tradesToImport.length > 0 ? 'info' : 'warn'
            );

            // Import
            const currentUser = this.authService.currentUser();
            if (!currentUser) throw new Error('User not logged in');

            this.syncProgress.set({ current: 0, total: tradesToImport.length });
            for (let i = 0; i < tradesToImport.length; i++) {
                this.tradeService.createTrade(tradesToImport[i], currentUser.id);
                this.syncProgress.set({ current: i + 1, total: tradesToImport.length });
            }

            const syncTime = new Date();
            this.lastSyncTime.set(syncTime);
            localStorage.setItem(SyncService.LAST_SYNC_KEY, syncTime.toISOString());
            conns.forEach(c => this.tradovateService.updateConnectionSyncTime(c.id));

            this.log(`Done! Imported ${tradesToImport.length} trade(s).`, 'success');
            this.syncProgress.set(null);

            return tradesToImport.length;

        } catch (err: any) {
            const msg = err?.message || 'Unknown error';
            this.log(`Sync failed: ${msg}`, 'error');
            console.error('Sync failed', err);
            throw err;
        } finally {
            this.isSyncing.set(false);
        }
    }
}
