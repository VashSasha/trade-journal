import { Injectable, signal, computed } from '@angular/core';
import { Trade, TradeFormData, TradeStats, TradeStatus } from '../models/trade.model';

const STORAGE_KEY = 'trade_journal_trades';

@Injectable({
    providedIn: 'root'
})
export class TradeService {
    private tradesSignal = signal<Trade[]>(this.loadTradesFromStorage());

    // Public readonly signals
    trades = this.tradesSignal.asReadonly();

    // Computed signals
    openTrades = computed(() =>
        this.tradesSignal().filter(t => t.status === 'open')
    );

    closedTrades = computed(() =>
        this.tradesSignal().filter(t => t.status === 'closed')
    );

    stats = computed(() => this.calculateStats());

    constructor() { }

    /**
     * Get all trades for current user
     */
    getAllTrades(): Trade[] {
        return this.tradesSignal();
    }

    /**
     * Get trade by ID
     */
    getTradeById(id: string): Trade | undefined {
        return this.tradesSignal().find(t => t.id === id);
    }

    /**
     * Create new trade
     */
    createTrade(formData: TradeFormData, userId: string): Trade {
        const now = new Date().toISOString();

        const trade: Trade = {
            id: this.generateId(),
            userId,
            ...formData,
            status: formData.exitPrice ? 'closed' : 'open',
            createdAt: now,
            updatedAt: now
        };

        // Calculate P&L if trade is closed
        if (trade.status === 'closed' && trade.exitPrice) {
            this.calculatePnL(trade);
        }

        // Add to array
        const updatedTrades = [...this.tradesSignal(), trade];
        this.tradesSignal.set(updatedTrades);
        this.saveTradesToStorage(updatedTrades);

        return trade;
    }

    /**
     * Update existing trade
     */
    updateTrade(id: string, updates: Partial<TradeFormData>): void {
        const trades = this.tradesSignal();
        const index = trades.findIndex(t => t.id === id);

        if (index === -1) return;

        const updatedTrade = {
            ...trades[index],
            ...updates,
            status: updates.exitPrice ? 'closed' as TradeStatus : trades[index].status,
            updatedAt: new Date().toISOString()
        };

        // Recalculate P&L if closed
        if (updatedTrade.status === 'closed' && updatedTrade.exitPrice) {
            this.calculatePnL(updatedTrade);
        }

        const updatedTrades = [
            ...trades.slice(0, index),
            updatedTrade,
            ...trades.slice(index + 1)
        ];

        this.tradesSignal.set(updatedTrades);
        this.saveTradesToStorage(updatedTrades);
    }

    /**
     * Delete trade
     */
    deleteTrade(id: string): void {
        const updatedTrades = this.tradesSignal().filter(t => t.id !== id);
        this.tradesSignal.set(updatedTrades);
        this.saveTradesToStorage(updatedTrades);
    }

    /**
     * Calculate P&L for a trade (mutates trade object)
     */
    private calculatePnL(trade: Trade): void {
        if (!trade.exitPrice || !trade.entryPrice) return;

        const multiplier = trade.direction === 'long' ? 1 : -1;
        const priceDiff = (trade.exitPrice - trade.entryPrice) * multiplier;

        trade.pnl = priceDiff * trade.quantity;
        trade.pnlPercent = (priceDiff / trade.entryPrice) * 100;
        trade.netPnl = trade.pnl - (trade.fees || 0);
    }

    /**
     * Calculate overall statistics
     */
    private calculateStats(): TradeStats {
        const allTrades = this.tradesSignal();
        const closed = allTrades.filter(t => t.status === 'closed');

        const winning = closed.filter(t => (t.netPnl || 0) > 0);
        const losing = closed.filter(t => (t.netPnl || 0) < 0);

        const totalPnl = closed.reduce((sum, t) => sum + (t.netPnl || 0), 0);
        const winningPnls = winning.map(t => t.netPnl || 0);
        const losingPnls = losing.map(t => t.netPnl || 0);

        return {
            totalTrades: allTrades.length,
            openTrades: allTrades.filter(t => t.status === 'open').length,
            closedTrades: closed.length,
            totalPnl,
            winningTrades: winning.length,
            losingTrades: losing.length,
            winRate: closed.length > 0 ? (winning.length / closed.length) * 100 : 0,
            averageWin: winningPnls.length > 0
                ? winningPnls.reduce((a, b) => a + b, 0) / winningPnls.length
                : 0,
            averageLoss: losingPnls.length > 0
                ? losingPnls.reduce((a, b) => a + b, 0) / losingPnls.length
                : 0,
            largestWin: winningPnls.length > 0 ? Math.max(...winningPnls) : 0,
            largestLoss: losingPnls.length > 0 ? Math.min(...losingPnls) : 0
        };
    }

    /**
     * Generate unique ID
     */
    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Load trades from localStorage
     */
    private loadTradesFromStorage(): Trade[] {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    /**
     * Save trades to localStorage
     */
    private saveTradesToStorage(trades: Trade[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    }

    /**
     * Add some mock trades for development
     */
    seedMockTrades(userId: string): void {
        const mockTrades: TradeFormData[] = [
            {
                symbol: 'AAPL',
                assetType: 'stock',
                direction: 'long',
                entryDate: '2024-01-15',
                entryPrice: 150.00,
                quantity: 10,
                exitDate: '2024-01-16',
                exitPrice: 155.00,
                fees: 2.00,
                setup: 'Breakout',
                tags: ['tech', 'swing'],
                notes: 'Clean breakout above resistance'
            },
            {
                symbol: 'TSLA',
                assetType: 'stock',
                direction: 'short',
                entryDate: '2024-01-20',
                entryPrice: 200.00,
                quantity: 5,
                exitDate: '2024-01-21',
                exitPrice: 195.00,
                fees: 1.50,
                setup: 'Reversal',
                tags: ['tech', 'day-trade']
            },
            {
                symbol: 'SPY',
                assetType: 'stock',
                direction: 'long',
                entryDate: '2024-01-25',
                entryPrice: 480.00,
                quantity: 20,
                fees: 3.00,
                setup: 'Trend Following',
                tags: ['index'],
                notes: 'Still holding'
            }
        ];

        mockTrades.forEach(trade => this.createTrade(trade, userId));
    }
}
