import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { GoalService } from './goal.service';
import { TradeService } from './trade.service';
import { UserSessionService } from './user-session.service';
import { UserDataRepo } from './user-data/user-data.repo';
import { Trade } from '../models/trade.model';
import { setCacheSuspended } from './user-data/user-data.cache';

describe('owner-scoped cloud goals', () => {
    const owner = signal<string | null>('A');
    const trades = signal<Trade[]>([]);
    const repo = { queueGoalUpsert: vi.fn(), queueGoalDelete: vi.fn() };
    let goals: GoalService;
    beforeEach(() => {
        localStorage.clear(); owner.set('A'); trades.set([]); vi.clearAllMocks(); setCacheSuspended(false);
        localStorage.setItem('trade_journal_goals', JSON.stringify([{ label: 'Unowned legacy goal' }]));
        TestBed.configureTestingModule({ providers: [
            { provide: TradeService, useValue: { trades } },
            { provide: UserSessionService, useValue: { userId: owner, capture: () => ({ userId: owner() }) } },
            { provide: UserDataRepo, useValue: repo },
        ] });
        goals = TestBed.inject(GoalService);
    });
    afterEach(() => { setCacheSuspended(false); vi.useRealTimers(); });
    it('keeps legacy data untouched and hides A’s goals immediately on switching to B', () => {
        expect(goals.goals()).toEqual([]);
        goals.addGoal('monthly_pnl', 500, 'month');
        expect(goals.goals()).toHaveLength(1);
        expect(repo.queueGoalUpsert).toHaveBeenCalledOnce();
        owner.set('B');
        expect(goals.goals()).toEqual([]);
        goals.deleteGoal(repo.queueGoalUpsert.mock.calls[0][0].id);
        expect(repo.queueGoalDelete).not.toHaveBeenCalled();
        owner.set(null);
        expect(goals.goals()).toEqual([]);
        expect(localStorage.getItem('trade_journal_goals')).toContain('Unowned legacy goal');
    });
    it('counts the last evening of the month, excludes next month and another owner, and does not persist progress', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 1));
        goals.addGoal('monthly_pnl', 500, 'month');
        trades.set([
            { userId: 'A', entryDate: new Date(2026, 7, 31, 23, 30).toISOString(), status: 'closed', netPnl: 100 },
            { userId: 'A', entryDate: new Date(2026, 8, 1).toISOString(), status: 'closed', netPnl: 500 },
            { userId: 'B', entryDate: new Date(2026, 7, 15).toISOString(), status: 'closed', netPnl: 999 },
        ] as Trade[]);
        expect(goals.goals()[0].current).toBe(100);
        expect(repo.queueGoalUpsert).toHaveBeenCalledOnce();
    });
    it('does not show a saved goal if queuing fails or accept an invalid target', () => {
        expect(() => goals.addGoal('win_rate', 101, 'month')).toThrow();
        repo.queueGoalUpsert.mockImplementationOnce(() => { throw new Error('Storage full'); });
        expect(() => goals.addGoal('monthly_pnl', 100, 'month')).toThrow('Storage full');
        expect(goals.goals()).toEqual([]);
    });
});
