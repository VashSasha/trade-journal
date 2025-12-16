import { Injectable, inject, signal } from '@angular/core';
import { TradovateService, TradovateFill } from './tradovate.service';
import { TradeService } from './trade.service';
import { Trade, AssetType, TradeDirection } from '../models/trade.model';
import { firstValueFrom } from 'rxjs';

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

    async syncTrades(): Promise<number> {
        if (this.isSyncing()) return 0;
        this.isSyncing.set(true);

        try {
            // 1. Fetch fills from the last month (for safety in this demo)
            const fromDate = new Date();
            fromDate.setMonth(fromDate.getMonth() - 1);

            const fills = await firstValueFrom(this.tradovateService.getFills(fromDate));

            // 2. Map fills to Trades
            const tradesToImport: Trade[] = [];
            const existingExternalIds = new Set(
                this.tradeService.trades()
                    .filter(t => t.source === 'tradovate')
                    .map(t => t.externalId)
            );

            for (const fill of fills) {
                // De-duplication
                if (existingExternalIds.has(fill.id.toString())) {
                    continue;
                }

                // Simple grouping logic: 
                // For now, we import each FILL as a separate TRADE for simplicity.
                // In a real app, we'd group fills into positions.

                const trade: any = { // Using any to partial match the form data structure if needed, or directly model
                    // But TradeService.createTrade expects form data or complete object? 
                    // Let's modify TradeService to accept a Trade object directly or reuse the logic.
                    // Actually TradeEntryComponent constructs the object.
                    // let's manually construct a valid Trade object mostly.

                    symbol: fill.symbol,
                    assetType: 'futures' as AssetType, // Tradovate is futures
                    direction: fill.side === 'Buy' ? 'long' : 'short' as TradeDirection,
                    entryDate: new Date(fill.timestamp),
                    entryPrice: fill.price,
                    quantity: fill.qty,

                    // For a fill, we don't have an exit yet unless we match headers.
                    // Assuming these are closed trades for the MVP mock? 
                    // Or we import them as "Open" trades?
                    // Let's import as Open trades for now to be safe.
                    status: 'open',

                    fees: fill.fee,
                    source: 'tradovate',
                    externalId: fill.id.toString(),
                    notes: 'Imported from Tradovate'
                };

                tradesToImport.push(trade);
            }

            // 3. Save to TradeService
            // We need a method in TradeService to bulk add or add one by one.
            // createTrade expects FormData-like object usually?
            // checking TradeService... it takes (tradeData: Partial<Trade>, userId: string)
            // We need a userId. Use a placeholder or inject AuthService.

            // For this scaffold, I'll return the count and let the caller handle UI feedback.
            // I'll assume we inject AuthService here or pass it in.

            // Wait, I need to actually save them.
            // Let's modify TradeService to allow `importTrade` which might bypass some form logic or handle it.

            console.log(`Found ${tradesToImport.length} new trades to import.`);

            // Mock Saving for the moment since I don't have user ID handy in this service readily without injecting Auth
            // But I can inject Auth.

            const currentUser = this.authService.currentUser();
            if (!currentUser) throw new Error('User not logged in');

            let importedCount = 0;
            for (const tradeData of tradesToImport) {
                // TradeService.createTrade takes (data, userId)
                // We need to ensure tradeData matches what createTrade expects.
                this.tradeService.createTrade(tradeData, currentUser.id);
                importedCount++;
            }

            return importedCount;
        } catch (error) {
            console.error('Sync failed', error);
            throw error;
        } finally {
            this.isSyncing.set(false);
            this.lastSyncTime.set(new Date());
        }
    }
}
