import { Injectable, inject, signal, computed } from '@angular/core';
import { Goal, GoalType } from '../models/goal.model';
import { TradeService } from './trade.service';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { CACHE_KEYS, cacheSuspended, readCache, writeCache } from './user-data/user-data.cache';

function cachedGoals(): Goal[] {
    const value = readCache<unknown>(CACHE_KEYS.goals);
    if (!Array.isArray(value)) return [];
    return value.filter((g): g is Goal => !!g && typeof g === 'object' && typeof g.id === 'string' &&
        typeof g.label === 'string' && typeof g.target === 'number' && Number.isFinite(g.target) && g.target > 0 &&
        ['monthly_pnl', 'yearly_pnl', 'monthly_trades', 'win_rate'].includes(g.type) &&
        ['month', 'year'].includes(g.period) && typeof g.deadline === 'string' && Number.isFinite(Date.parse(g.deadline)));
}

/** Goal definitions are owner-scoped cloud data; progress is derived, never saved. */
@Injectable({ providedIn: 'root' })
export class GoalService {
    private trades = inject(TradeService);
    private session = inject(UserSessionService);
    private repo = inject(UserDataRepo);
    private state = signal({
        owner: readCache<string>(CACHE_KEYS.owner),
        items: cachedGoals()
    });

    readonly goals = computed(() => {
        const owner = this.session.userId();
        const state = this.state();
        if (!owner || state.owner !== owner || cacheSuspended()) return [];
        const trades = this.trades.trades().filter(t => t.userId === owner);
        return state.items.map(goal => {
            const deadline = new Date(goal.deadline);
            const start = goal.period === 'month'
                ? new Date(deadline.getFullYear(), deadline.getMonth(), 1)
                : new Date(deadline.getFullYear(), 0, 1);
            // Include the entire final day, including goals created by older builds.
            const end = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate() + 1);
            const relevant = trades.filter(t => {
                const entry = new Date(t.entryDate);
                return entry >= start && entry < end && t.status !== 'missed';
            });
            const closed = relevant.filter(t => t.status === 'closed');
            const current = goal.type === 'monthly_trades' ? relevant.length
                : goal.type === 'win_rate'
                    ? (closed.length ? 100 * closed.filter(t => (t.netPnl ?? 0) > 0).length / closed.length : 0)
                    : closed.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
            return { ...goal, current };
        });
    });

    hydrate(items: Goal[], owner: string | null): void {
        this.state.set({ owner, items });
        writeCache(CACHE_KEYS.goals, items);
    }

    addGoal(type: GoalType, target: number, period: 'month' | 'year'): void {
        if (cacheSuspended()) return;
        const owner = this.session.capture().userId;
        if (!Number.isFinite(target) || target <= 0 || (type === 'win_rate' && target > 100)) {
            throw new Error('Enter a valid positive goal target. Win rate cannot exceed 100%.');
        }
        const now = new Date();
        const deadline = period === 'month'
            ? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
            : new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        const periodLabel = period === 'month' ? now.toLocaleString('default', { month: 'long' }) : now.getFullYear();
        const metric = type === 'monthly_trades' ? 'Trade Count' : type === 'win_rate' ? 'Win Rate' : 'P&L Target';
        const goal: Goal = { id: crypto.randomUUID(), type, target, period, label: periodLabel + ' ' + metric,
            current: 0, deadline: deadline.toISOString(), status: 'active' };
        this.repo.queueGoalUpsert(goal); // Durable before changing the UI.
        this.hydrate([...(this.state().owner === owner ? this.state().items : []), goal], owner);
    }

    deleteGoal(id: string): void {
        if (cacheSuspended()) return;
        const owner = this.session.capture().userId;
        if (this.state().owner !== owner) return;
        this.repo.queueGoalDelete(id);
        this.hydrate(this.state().items.filter(goal => goal.id !== id), owner);
    }
}
