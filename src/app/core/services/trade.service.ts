import { Injectable, signal, computed } from '@angular/core';
import { Trade, TradeFormData, TradeStats, TradeStatus } from '../models/trade.model';

const STORAGE_KEY = 'trade_journal_trades';

@Injectable({
    providedIn: 'root'
})
export class TradeService {
    private tradesSignal = signal<Trade[]>(this.loadTradesFromStorage());

    trades = this.tradesSignal.asReadonly();

    openTrades = computed(() =>
        this.tradesSignal().filter(t => t.status === 'open')
    );

    closedTrades = computed(() =>
        this.tradesSignal().filter(t => t.status === 'closed')
    );

    stats = computed(() => this.calculateStats(this.tradesSignal()));

    constructor() { }

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

        // Determine status: use form status if valid (missed), otherwise infer from exit price
        let status: TradeStatus = formData.status === 'missed' ? 'missed' : (formData.exitPrice ? 'closed' : 'open');

        const trade: Trade = {
            id: this.generateId(),
            userId,
            ...formData,
            status,
            createdAt: now,
            updatedAt: now
        };

        // Calculate P&L if trade is closed OR missed (missed trades can have theoretical P&L)
        if ((trade.status === 'closed' || trade.status === 'missed') && trade.exitPrice) {
            if (trade.pnl !== undefined) {
                if (trade.netPnl === undefined) {
                    trade.netPnl = trade.pnl - (trade.fees || 0);
                }
            } else {
                this.calculatePnL(trade);
            }
        }

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

        let newStatus = trades[index].status;

        if (updates.status) {
            newStatus = updates.status;
        } else if (updates.exitPrice) {
            // If exiting an open trade, close it, UNLESS it was missed
            if (newStatus !== 'missed') {
                newStatus = 'closed';
            }
        }

        const updatedTrade = {
            ...trades[index],
            ...updates,
            status: newStatus,
            updatedAt: new Date().toISOString()
        };

        if ((updatedTrade.status === 'closed' || updatedTrade.status === 'missed') && updatedTrade.exitPrice) {
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

    deleteTrades(ids: Set<string>): void {
        const updatedTrades = this.tradesSignal().filter(t => !ids.has(t.id));
        this.tradesSignal.set(updatedTrades);
        this.saveTradesToStorage(updatedTrades);
    }

    /**
     * Calculate P&L for a trade (mutates trade object)
     */
    private calculatePnL(trade: Trade): void {
        if (!trade.exitPrice || !trade.entryPrice) return;

        const multiplier = trade.direction === 'long' ? 1 : -1;
        const contractMult = trade.multiplier || 1;
        const priceDiff = (trade.exitPrice - trade.entryPrice) * multiplier;

        trade.pnl = priceDiff * trade.quantity * contractMult;
        trade.pnlPercent = (priceDiff / trade.entryPrice) * 100;
        trade.netPnl = trade.pnl - (trade.fees || 0);
    }

    /**
     * Calculate overall statistics
     */
    calculateStats(allTrades: Trade[]): TradeStats {

        const activeTrades = allTrades.filter(t => t.status !== 'missed');
        const closed = activeTrades.filter(t => t.status === 'closed');

        const winning = closed.filter(t => (t.netPnl || 0) > 0);
        const losing = closed.filter(t => (t.netPnl || 0) < 0);

        const totalPnl = closed.reduce((sum, t) => sum + (t.netPnl || 0), 0);
        const totalPoints = closed.reduce((sum, t) => {
            if (t.exitPrice && t.entryPrice) {
                const diff = t.direction === 'long'
                    ? t.exitPrice - t.entryPrice
                    : t.entryPrice - t.exitPrice;
                return sum + diff * (t.quantity || 1);
            }
            return sum;
        }, 0);
        const winningPnls = winning.map(t => t.netPnl || 0);
        const losingPnls = losing.map(t => t.netPnl || 0);

        return {
            totalTrades: activeTrades.length,
            openTrades: activeTrades.filter(t => t.status === 'open').length,
            closedTrades: closed.length,
            totalPnl,
            totalPoints,
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

}
