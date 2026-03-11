import { Injectable, computed, signal } from '@angular/core';
import { Trade } from '../models/trade.model';

export interface FilterState {
    dateRange: { start: Date | null; end: Date | null };
    symbols: string[];
    setups: string[];
    sides: ('long' | 'short')[];
    accountIds: string[];
}

@Injectable({
    providedIn: 'root'
})
export class FilterService {
    // State
    private state = signal<FilterState>({
        dateRange: { start: null, end: null },
        symbols: [],
        setups: [],
        sides: [],
        accountIds: []
    });

    // Selectors
    filters = this.state.asReadonly();

    // Actions
    setDateRange(start: Date | null, end: Date | null) {
        this.state.update(s => ({ ...s, dateRange: { start, end } }));
    }

    toggleSymbol(symbol: string) {
        this.state.update(s => {
            const symbols = s.symbols.includes(symbol)
                ? s.symbols.filter(x => x !== symbol)
                : [...s.symbols, symbol];
            return { ...s, symbols };
        });
    }

    toggleSetup(setup: string) {
        this.state.update(s => {
            const setups = s.setups.includes(setup)
                ? s.setups.filter(x => x !== setup)
                : [...s.setups, setup];
            return { ...s, setups };
        });
    }

    toggleSide(side: 'long' | 'short') {
        this.state.update(s => {
            const sides = s.sides.includes(side)
                ? s.sides.filter(x => x !== side)
                : [...s.sides, side];
            return { ...s, sides };
        });
    }

    toggleAccount(accountId: string) {
        this.state.update(s => {
            const accountIds = s.accountIds.includes(accountId)
                ? s.accountIds.filter(x => x !== accountId)
                : [...s.accountIds, accountId];
            return { ...s, accountIds };
        });
    }

    updateAccounts(accountIds: string[]) {
        this.state.update(s => ({ ...s, accountIds }));
    }

    reset() {
        this.state.set({
            dateRange: { start: null, end: null },
            symbols: [],
            setups: [],
            sides: [],
            accountIds: []
        });
    }

    // Filtering Logic
    filterTrades(trades: Trade[]): Trade[] {
        const s = this.state();

        return trades.filter(t => {
            // Date Range
            if (s.dateRange.start && new Date(t.entryDate) < s.dateRange.start) return false;
            if (s.dateRange.end) {
                const entry = new Date(t.entryDate);
                const end = new Date(s.dateRange.end);
                end.setHours(23, 59, 59, 999);
                if (entry > end) return false;
            }

            // Symbols
            if (s.symbols.length > 0 && !s.symbols.includes(t.symbol)) return false;

            // Setups
            if (s.setups.length > 0 && (!t.setup || !s.setups.includes(t.setup))) return false;

            // Sides
            if (s.sides.length > 0 && !s.sides.includes(t.direction)) return false;


            if (s.accountIds.length > 0) {
                if (t.accountId && !s.accountIds.includes(t.accountId)) {
                    return false;
                }
            }

            return true;
        });
    }
}
