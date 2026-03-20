import { Injectable, inject, signal } from '@angular/core';
import { TradovateService, TradovateFill, TradovateAccount } from './tradovate.service';
import { TradeService } from './trade.service';
import { firstValueFrom, Observable } from 'rxjs';
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

    isSyncing = signal(false);
    lastSyncTime = signal<Date | null>(null);
    syncLog = signal<SyncLogEntry[]>([]);
    syncProgress = signal<{ current: number; total: number } | null>(null);

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
            const activeConn = this.tradovateService.activeConnection();
            if (!activeConn) throw new Error('No active Tradovate connection');

            this.log(`Connected as: ${activeConn.name}`);

            // Fetch fills
            this.log('Fetching fills from Tradovate Reports API...');
            const fills = await firstValueFrom(
                this.tradovateService.getAllFills(fromDate)
            );
            this.log(`Retrieved ${fills.length} raw fill(s)`, fills.length > 0 ? 'success' : 'warn');

            if (fills.length === 0) {
                this.log('No fills found for the selected date range.', 'warn');
                this.lastSyncTime.set(new Date());
                return 0;
            }

            // Fetch accounts for name mapping
            const accounts = await firstValueFrom(
                this.tradovateService.getAccounts() as Observable<TradovateAccount[]>
            );
            const accountMap = new Map<number, string>();
            accounts.forEach((acc: TradovateAccount) => accountMap.set(acc.id, acc.name));
            this.log(`Loaded ${accounts.length} account(s)`);

            // Fetch contract details for multipliers
            const contractIds = new Set(fills.map(f => f.contractId).filter(id => !!id) as number[]);
            const contractMap = new Map<number, any>();
            this.log(`Fetching details for ${contractIds.size} contract(s)...`);
            this.syncProgress.set({ current: 0, total: contractIds.size });

            let contractIdx = 0;
            for (const id of contractIds) {
                try {
                    const contract = await firstValueFrom(this.tradovateService.getContract(id));
                    contractMap.set(id, contract);
                } catch {
                    this.log(`Could not load contract ${id} — using symbol fallback`, 'warn');
                }
                contractIdx++;
                this.syncProgress.set({ current: contractIdx, total: contractIds.size });
            }

            // FIFO match fills into trades
            this.log('Running FIFO matching algorithm...');
            const matchedTrades = this.matchTrades(fills, contractMap, accountMap, activeConn.id);
            this.log(`Matched ${matchedTrades.length} trade(s)`);

            // Deduplicate
            const existingExternalIds = new Set(
                this.tradeService.trades()
                    .filter(t => t.source === 'tradovate')
                    .map(t => t.externalId)
            );
            const tradesToImport = matchedTrades.filter(t => !existingExternalIds.has(t.externalId));
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

            this.lastSyncTime.set(new Date());
            this.tradovateService.updateConnectionSyncTime(activeConn.id);

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

    private matchTrades(
        fills: TradovateFill[],
        contractMap: Map<number, any>,
        accountMap: Map<number, string>,
        connectionId: string
    ): any[] {
        const sortedFills = [...fills].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const trades: any[] = [];
        const openPositions = new Map<string, TradovateFill[]>();

        const getMultiplier = (fill: TradovateFill): number => {
            if (fill.contractId && contractMap.has(fill.contractId)) {
                const c = contractMap.get(fill.contractId);
                if (c.pointValue) return c.pointValue;
                const name = (c.name || '').toUpperCase();
                if (name.includes('MNQ') || name.includes('MICRO E-MINI NASDAQ')) return 2;
                if (name.includes('MES') || name.includes('MICRO E-MINI S&P')) return 5;
                if (name.includes('NQ') || name.includes('E-MINI NASDAQ')) return 20;
                if (name.includes('ES') || name.includes('E-MINI S&P')) return 50;
                if (name.includes('CL') || name.includes('CRUDE OIL')) return 1000;
                if (name.includes('GC') || name.includes('GOLD')) return 100;
            }
            const sym = (fill.symbol || '').toUpperCase();
            if (sym.includes('MNQ')) return 2;
            if (sym.includes('MES')) return 5;
            if (sym.includes('NQ')) return 20;
            if (sym.includes('ES')) return 50;
            if (sym.includes('CL')) return 1000;
            if (sym.includes('GC')) return 100;
            return 1;
        };

        for (const fill of sortedFills) {
            const sym = fill.contractId
                ? (contractMap.get(fill.contractId)?.name || fill.symbol)
                : fill.symbol;
            const multiplier = getMultiplier(fill);
            const currentPosition = openPositions.get(sym) || [];

            if (currentPosition.length === 0 || currentPosition[0].action === fill.action) {
                currentPosition.push({ ...fill });
                openPositions.set(sym, currentPosition);
            } else {
                let remainingQty = fill.qty;

                while (remainingQty > 0 && currentPosition.length > 0) {
                    const openFill = currentPosition[0];
                    const matchQty = Math.min(remainingQty, openFill.qty);
                    const isLong = openFill.action === 'Buy';
                    const entryPrice = openFill.price;
                    const exitPrice = fill.price;
                    const pnl = parseFloat(
                        ((isLong ? exitPrice - entryPrice : entryPrice - exitPrice) * matchQty * multiplier).toFixed(2)
                    );

                    trades.push({
                        symbol: sym,
                        assetType: 'futures',
                        direction: isLong ? 'long' : 'short',
                        entryDate: new Date(openFill.timestamp).toISOString(),
                        exitDate: new Date(fill.timestamp).toISOString(),
                        entryPrice,
                        exitPrice,
                        quantity: matchQty,
                        status: 'closed',
                        pnl,
                        netPnl: pnl, // fees are 0 for Tradovate fills
                        fees: 0,
                        multiplier,
                        pnlPercent: this.calculatePnlPercent(entryPrice, exitPrice, isLong),
                        source: 'tradovate',
                        connectionId,
                        externalId: `tradovate_paired_${openFill.id}_${fill.id}`,
                        accountId: openFill.accountId?.toString(),
                        accountName: openFill.accountId ? accountMap.get(openFill.accountId) : undefined,
                        notes: 'Matched Trade (FIFO)'
                    });

                    remainingQty -= matchQty;
                    openFill.qty -= matchQty;
                    if (openFill.qty <= 0) currentPosition.shift();
                }

                if (remainingQty > 0) {
                    currentPosition.push({ ...fill, qty: remainingQty });
                    openPositions.set(sym, currentPosition);
                }

                if (currentPosition.length === 0) openPositions.delete(sym);
            }
        }

        // Remaining open positions
        openPositions.forEach((fills, sym) => {
            fills.forEach(fill => {
                trades.push({
                    symbol: sym,
                    assetType: 'futures',
                    direction: fill.action === 'Buy' ? 'long' : 'short',
                    entryDate: new Date(fill.timestamp).toISOString(),
                    entryPrice: fill.price,
                    quantity: fill.qty,
                    status: 'open',
                    fees: 0,
                    source: 'tradovate',
                    connectionId,
                    externalId: `tradovate_open_${fill.id}`,
                    accountId: fill.accountId?.toString(),
                    accountName: fill.accountId ? accountMap.get(fill.accountId) : undefined,
                    notes: 'Open Position (Unmatched)'
                });
            });
        });

        return trades;
    }

    private calculatePnlPercent(entry: number, exit: number, isLong: boolean): number {
        if (!entry) return 0;
        const diff = isLong ? (exit - entry) : (entry - exit);
        return (diff / entry) * 100;
    }
}
