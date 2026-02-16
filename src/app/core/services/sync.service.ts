import { Injectable, inject, signal } from '@angular/core';
import { TradovateService, TradovateFill, TradovateAccount } from './tradovate.service';
import { TradeService } from './trade.service';
import { firstValueFrom, Observable } from 'rxjs';

import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class SyncService {
    private tradovateService = inject(TradovateService);
    private tradeService = inject(TradeService);
    private authService = inject(AuthService);

    isSyncing = signal(false);
    lastSyncTime = signal<Date | null>(null);
    syncAllConnections = signal(false); // Toggle for syncing all connections vs just active

    async syncTrades(): Promise<number> {
        if (this.isSyncing()) return 0;
        this.isSyncing.set(true);

        try {
            const fromDate = new Date();
            // Fetch fill history from a long time ago (e.g. 2020) to get "all time"
            fromDate.setFullYear(2020, 0, 1);

            // Use getAllFills to get historical data from Reports API
            const fills = await firstValueFrom(this.tradovateService.getAllFills(fromDate));

            console.log(`[Sync] Fetched ${fills.length} fills from Tradovate (Reports API)`);

            const accounts = await firstValueFrom(this.tradovateService.getAccounts() as Observable<TradovateAccount[]>);
            const accountMap = new Map<number, string>();
            accounts.forEach((acc: TradovateAccount) => accountMap.set(acc.id, acc.name));

            const contractIds = new Set(fills.map(f => f.contractId).filter(id => !!id) as number[]);
            const contractMap = new Map<number, any>();

            for (const id of contractIds) {
                try {
                    const contract = await firstValueFrom(this.tradovateService.getContract(id));
                    contractMap.set(id, contract);
                } catch (err) {
                    console.error(`Failed to fetch contract ${id}`, err);
                }
            }

            const matchedTrades = this.matchTrades(fills, contractMap, accountMap);

            const existingExternalIds = new Set(
                this.tradeService.trades()
                    .filter(t => t.source === 'tradovate')
                    .map(t => t.externalId)
            );

            const tradesToImport = matchedTrades.filter(t => !existingExternalIds.has(t.externalId));

            const currentUser = this.authService.currentUser();
            if (!currentUser) throw new Error('User not logged in');

            let importedCount = 0;
            for (const tradeData of tradesToImport) {
                this.tradeService.createTrade(tradeData, currentUser.id);
                importedCount++;
            }

            this.lastSyncTime.set(new Date());
            return importedCount;
        } catch (err) {
            console.error('Sync failed', err);
            throw err;
        } finally {
            this.isSyncing.set(false);
        }
    }

    private matchTrades(fills: TradovateFill[], contractMap: Map<number, any>, accountMap: Map<number, string>): any[] {
        const sortedFills = [...fills].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
            if (sym.includes('MNQ') || sym.includes('MES')) return sym.includes('MNQ') ? 2 : 5;
            if (sym.includes('NQ')) return 20;
            if (sym.includes('ES')) return 50;
            if (sym.includes('CL')) return 1000;
            if (sym.includes('GC')) return 100;

            return 1;
        };

        for (const fill of sortedFills) {
            const sym = fill.contractId ? (contractMap.get(fill.contractId)?.name || fill.symbol) : fill.symbol;
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
                    const pnl = (isLong ? (exitPrice - entryPrice) : (entryPrice - exitPrice)) * matchQty * multiplier;

                    trades.push({
                        symbol: sym,
                        assetType: 'futures',
                        direction: isLong ? 'long' : 'short',
                        entryDate: new Date(openFill.timestamp).toISOString(),
                        exitDate: new Date(fill.timestamp).toISOString(),
                        entryPrice: entryPrice,
                        exitPrice: exitPrice,
                        quantity: matchQty,
                        status: 'closed',
                        pnl: parseFloat(pnl.toFixed(2)),
                        fees: 0,
                        multiplier: multiplier,
                        pnlPercent: this.calculatePnlPercent(entryPrice, exitPrice, isLong),
                        source: 'tradovate',
                        externalId: `tradovate_paired_${openFill.id}_${fill.id}`,
                        accountId: openFill.accountId?.toString(),
                        accountName: openFill.accountId ? accountMap.get(openFill.accountId) : undefined,
                        notes: `Matched Trade (FIFO)`
                    });

                    remainingQty -= matchQty;
                    openFill.qty -= matchQty;

                    if (openFill.qty <= 0) {
                        currentPosition.shift();
                    }
                }

                if (remainingQty > 0) {
                    const remainderFill = { ...fill, qty: remainingQty };
                    currentPosition.push(remainderFill);
                    openPositions.set(sym, currentPosition);
                }

                if (currentPosition.length === 0) {
                    openPositions.delete(sym);
                }
            }
        }

        openPositions.forEach((fills, sym) => {
            fills.forEach(fill => {
                trades.push({
                    symbol: sym,
                    assetType: 'futures',
                    direction: fill.action === 'Buy' ? 'long' : 'short',
                    entryDate: new Date(fill.timestamp),
                    entryPrice: fill.price,
                    quantity: fill.qty,
                    status: 'open',
                    fees: 0,
                    source: 'tradovate',
                    externalId: `tradovate_open_${fill.id}`,
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
