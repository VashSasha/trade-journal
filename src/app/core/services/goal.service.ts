import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { Goal, GoalType } from '../models/goal.model';
import { TradeService } from './trade.service';

const STORAGE_KEY = 'trade_journal_goals';

@Injectable({
    providedIn: 'root'
})
export class GoalService {
    private tradeService = inject(TradeService);

    // Signals
    private goalsSignal = signal<Goal[]>(this.loadGoals());
    goals = this.goalsSignal.asReadonly();

    constructor() {
        // Re-calculate goal progress whenever trades change
        effect(() => {
            const trades = this.tradeService.trades(); // Dependency on trades
            this.updateGoalProgress();
        }, { allowSignalWrites: true });
    }

    /**
     * Create a new goal
     */
    addGoal(type: GoalType, target: number, period: 'month' | 'year'): void {
        const now = new Date();
        let deadline: Date;
        let label = '';

        if (period === 'month') {
            // End of current month
            deadline = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const monthName = now.toLocaleString('default', { month: 'long' });
            label = `${monthName} `;
        } else {
            // End of current year
            deadline = new Date(now.getFullYear(), 11, 31);
            label = `${now.getFullYear()} `;
        }

        switch (type) {
            case 'monthly_pnl': label += `P&L Target`; break;
            case 'yearly_pnl': label += `P&L Target`; break;
            case 'monthly_trades': label += `Trade Count`; break;
            case 'win_rate': label += `Win Rate`; break;
        }

        const newGoal: Goal = {
            id: Date.now().toString(),
            type,
            label,
            target,
            current: 0,
            deadline: deadline.toISOString(),
            status: 'active',
            period
        };

        const updated = [...this.goalsSignal(), newGoal];
        this.goalsSignal.set(updated);
        this.updateGoalProgress(); // Calculate initial progress
        this.saveGoals(updated);
    }

    /**
     * Remove a goal
     */
    deleteGoal(id: string): void {
        const updated = this.goalsSignal().filter(g => g.id !== id);
        this.goalsSignal.set(updated);
        this.saveGoals(updated);
    }

    /**
     * Calculate progress for all active goals based on current trades
     */
    private updateGoalProgress(): void {
        const trades = this.tradeService.trades();
        const goals = this.goalsSignal();

        const updatedGoals = goals.map(goal => {
            if (goal.status !== 'active') return goal;

            const deadline = new Date(goal.deadline);
            const now = new Date();

            // Determine start date for the goal period
            let startDate: Date;
            if (goal.period === 'month') {
                startDate = new Date(deadline.getFullYear(), deadline.getMonth(), 1);
            } else {
                startDate = new Date(deadline.getFullYear(), 0, 1);
            }

            // Filter trades within this period
            const relevantTrades = trades.filter(t => {
                const entry = new Date(t.entryDate);
                return entry >= startDate && entry <= deadline && t.status !== 'missed';
            });

            // Calculate current value
            let current = 0;
            const closedTrades = relevantTrades.filter(t => t.status === 'closed');

            switch (goal.type) {
                case 'monthly_pnl':
                case 'yearly_pnl':
                    current = closedTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0);
                    break;
                case 'monthly_trades':
                    current = relevantTrades.length;
                    break;
                case 'win_rate':
                    if (closedTrades.length > 0) {
                        const wins = closedTrades.filter(t => (t.netPnl || 0) > 0).length;
                        current = (wins / closedTrades.length) * 100;
                    }
                    break;
            }

            // Check status (simple check, can be expanded)
            // Note: For P&L, passing target is 'achieved'. 
            // For now we just update 'current'. Status change logic could be more complex (e.g. at deadline).

            return { ...goal, current };
        });

        // Only update if changes to avoid loops, though signal equality check helps
        // JSON stringify comparison is explicit
        if (JSON.stringify(updatedGoals) !== JSON.stringify(goals)) {
            this.goalsSignal.set(updatedGoals);
            this.saveGoals(updatedGoals);
        }
    }

    private loadGoals(): Goal[] {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    private saveGoals(goals: Goal[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
    }
}
