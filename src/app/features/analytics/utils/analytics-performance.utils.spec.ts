import { Trade } from '../../../core/models/trade.model';
import {
    buildAnnualPerformance,
    buildAnalyticsObservations,
    computeAnalyticsPerformance,
} from './analytics-performance.utils';

function execution(
    id: string,
    accountId: string,
    entrySeconds: number,
    pnl: number,
): Trade {
    const at = (seconds: number) => new Date(Date.UTC(2026, 7, 4, 14, 30, seconds)).toISOString();
    return {
        id,
        userId: 'user',
        symbol: 'MNQU6',
        assetType: 'futures',
        direction: 'long',
        entryDate: at(entrySeconds),
        exitDate: at(entrySeconds + 60),
        entryPrice: 23_000,
        exitPrice: 23_010,
        quantity: 1,
        pnl,
        netPnl: pnl,
        source: 'tradovate',
        accountId,
        status: 'closed',
        createdAt: at(entrySeconds),
        updatedAt: at(entrySeconds + 60),
    };
}

describe('analytics performance utilities', () => {
    const copyTraded = [
        execution('a-1', 'one', 0, 100),
        execution('a-2', 'two', 2, 100),
        execution('a-3', 'three', 3, 100),
        execution('b-1', 'one', 300, -50),
        execution('b-2', 'two', 302, -50),
        execution('b-3', 'three', 303, -50),
    ];

    it('groups copied executions while preserving combined P&L', () => {
        const decisions = buildAnalyticsObservations(copyTraded, 'decision');
        const executions = buildAnalyticsObservations(copyTraded, 'execution');

        expect(decisions).toHaveLength(2);
        expect(executions).toHaveLength(6);
        expect(decisions.reduce((sum, item) => sum + item.pnl, 0)).toBe(150);
        expect(executions.reduce((sum, item) => sum + item.pnl, 0)).toBe(150);
        expect(decisions.map(item => item.executionCount)).toEqual([3, 3]);
    });

    it('computes behavioral metrics from the selected lens', () => {
        const decisionMetrics = computeAnalyticsPerformance(copyTraded, 'decision');
        const executionMetrics = computeAnalyticsPerformance(copyTraded, 'execution');

        expect(decisionMetrics).toMatchObject({
            count: 2,
            netPnl: 150,
            winners: 1,
            losers: 1,
            winRate: 50,
            expectancy: 75,
            averageWin: 300,
            averageLoss: -150,
            maxDrawdown: -150,
            bestStreak: 1,
            worstStreak: 1,
        });
        expect(decisionMetrics.profitFactor).toBe(2);
        expect(executionMetrics.count).toBe(6);
        expect(executionMetrics.expectancy).toBe(25);
    });

    it('combines overlapping scale-ins into a position without merging a later scalp', () => {
        const scaledEntry = [
            execution('scale-1', 'one', 0, 40),
            execution('scale-2', 'one', 20, 50),
            execution('scale-3', 'one', 40, 60),
        ].map((trade, index) => ({
            ...trade,
            exitDate: new Date(Date.UTC(2026, 7, 4, 14, 32, 10 - index * 5)).toISOString(),
        }));
        const laterScalp = execution('later', 'one', 240, -25);

        const positions = buildAnalyticsObservations([...scaledEntry, laterScalp], 'position');
        const decisions = buildAnalyticsObservations([...scaledEntry, laterScalp], 'decision');

        expect(positions).toHaveLength(2);
        expect(positions[0]).toMatchObject({ pnl: 150, executionCount: 3, accountCount: 1 });
        expect(positions[1]).toMatchObject({ pnl: -25, executionCount: 1 });
        expect(decisions).toHaveLength(4);
    });

    it('keeps overlapping positions on different accounts separate', () => {
        const positions = buildAnalyticsObservations([
            execution('one', 'account-a', 0, 40),
            execution('two', 'account-b', 2, 40),
        ], 'position');

        expect(positions).toHaveLength(2);
    });

    it('ignores open trades and handles an all-winning sample', () => {
        const open = { ...execution('open', 'one', 900, 500), status: 'open' as const };
        const metrics = computeAnalyticsPerformance([
            execution('winner', 'one', 0, 100),
            open,
        ], 'execution');

        expect(metrics.count).toBe(1);
        expect(metrics.netPnl).toBe(100);
        expect(metrics.profitFactorInfinite).toBe(true);
        expect(metrics.maxDrawdown).toBe(0);
    });

    it('builds monthly rows with decision-aware counts and unchanged P&L', () => {
        const decisions = buildAnnualPerformance(copyTraded, 'decision');
        const executions = buildAnnualPerformance(copyTraded, 'execution');
        const augustDecisions = decisions[0].months[7];
        const augustExecutions = executions[0].months[7];

        expect(decisions[0].year).toBe(2026);
        expect(augustDecisions).toMatchObject({ pnl: 150, count: 2, winners: 1, losers: 1, winRate: 50 });
        expect(augustExecutions).toMatchObject({ pnl: 150, count: 6, winners: 3, losers: 3, winRate: 50 });
        expect(decisions[0].pnl).toBe(executions[0].pnl);
        expect(augustDecisions.intensity).toBe(4);
    });
});
