import { Trade } from '../models/trade.model';
import { groupTradePositions, inferPositionActivity } from './trade-positions.utils';
import { buildEquityCurve, computeDayStats } from './trade-stats.utils';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 2, 14, minutes)).toISOString();
function row(id: string, entry: number, exit: number, overrides: Partial<Trade> = {}): Trade {
    return { id, userId: 'owner', accountId: 'one', connectionId: 'c1', source: 'tradovate',
        symbol: 'MNQZ6', assetType: 'futures', direction: 'long', quantity: 2,
        entryDate: at(entry), exitDate: at(exit), entryPrice: 100, exitPrice: 102,
        pnl: 10, fees: 1, netPnl: 9, status: 'closed', createdAt: at(entry), updatedAt: at(exit), ...overrides };
}

describe('shared position grouping', () => {
    it('counts slow scale-ins and partial exits as one position until flat, preserving all rows and money', () => {
        const rows = [row('one', 0, 20), row('add-1', 5, 18), row('add-2', 15, 25)];
        const before = JSON.stringify(rows);
        const activity = inferPositionActivity(rows);
        expect(activity).toMatchObject({ decisionCount: 1, positionCount: 1, executionCount: 3, ungroupedExecutionCount: 0 });
        expect(activity.decisions[0].trades).toEqual(rows);
        expect(activity.groupedTrades[0]).toMatchObject({ quantity: 6, pnl: 30, netPnl: 27, fees: 3, entryDate: at(0), exitDate: at(25) });
        expect(JSON.stringify(rows)).toBe(before);
    });
    it('does not merge touching intervals or a re-entry after going flat, even seconds later', () => {
        expect(groupTradePositions([row('a', 0, 1), row('b', 1, 2), row('c', 2.5, 3)])).toHaveLength(3);
    });
    it('keeps owners, brokers, connections, accounts, contracts, and directions separate', () => {
        const base = row('base', 0, 10);
        for (const change of [{ userId: 'other' }, { source: 'manual' as const }, { connectionId: 'c2' },
            { accountId: 'two' }, { symbol: 'MESZ6' }, { direction: 'short' as const }]) {
            expect(groupTradePositions([base, { ...base, id: 'other', ...change }])).toHaveLength(2);
        }
    });
    it('groups copies after scale-ins without throwing away their financial totals', () => {
        const rows = ['one', 'two', 'three', 'four', 'five'].flatMap(accountId =>
            [0, 2, 4, 6, 8].map((entry, index) => row(`${accountId}:${index}`, entry, 20, { accountId })));
        const activity = inferPositionActivity(rows);
        expect(activity).toMatchObject({ decisionCount: 1, positionCount: 5, executionCount: 25, accountCount: 5, mirroredDecisionCount: 1 });
        expect(activity.decisions[0].trades).toHaveLength(25);
        expect(activity.groupedTrades[0].netPnl).toBe(225);
        expect(activity.groupedTrades[0].fees).toBe(25);
    });
    it('keeps genuinely different account positions distinct', () => {
        expect(inferPositionActivity([row('one', 0, 20), row('two', 2, 25, { accountId: 'two' })]).decisionCount).toBe(2);
    });
    it('keeps incomplete copied rows separate instead of asserting a shared completed position', () => {
        const activity = inferPositionActivity(['one', 'two'].map(accountId => row(accountId, 0, 20, { accountId, exitDate: undefined })));
        expect(activity).toMatchObject({ decisionCount: 2, ungroupedExecutionCount: 2 });
    });
    it('marks realized partial exits provisional while contracts remain open, without losing their P&L', () => {
        const closed = [row('partial', 0, 10), row('partial-2', 5, 15)];
        const context = [...closed, row('remainder', 3, 20, { status: 'open', exitDate: undefined })];
        const activity = inferPositionActivity(closed, context);
        expect(activity).toMatchObject({ executionCount: 2, decisionCount: 1, ungroupedExecutionCount: 2 });
        expect(activity.groupedTrades[0].netPnl).toBe(18);
        expect(inferPositionActivity(closed, [...closed, row('new-open', 16, 20, { status: 'open' })]).ungroupedExecutionCount).toBe(0);
    });
    it('does not infer intraday grouping from date-only, missing, reversed, or zero-length timestamps', () => {
        for (const fields of [{ entryDate: '2026-10-02', exitDate: '2026-10-02' }, { entryDate: 'bad' },
            { exitDate: undefined }, { exitDate: at(-1) }, { exitDate: at(0) }, { accountId: undefined, accountName: undefined }]) {
            const activity = inferPositionActivity([row('a', 0, 20, fields), row('b', 0, 20, fields)]);
            expect(activity.positionCount).toBe(2);
            expect(activity.ungroupedExecutionCount).toBe(2);
        }
    });
    it('supports separate date/time fields and overnight intervals; excludes open and missed records', () => {
        const activity = inferPositionActivity([
            row('a', 0, 20, { entryDate: '2026-10-01', entryTime: '23:50', exitDate: '2026-10-02', exitTime: '00:20' }),
            row('b', 0, 20, { entryDate: '2026-10-02', entryTime: '00:05', exitDate: '2026-10-02', exitTime: '00:25' }),
            row('open', 0, 20, { status: 'open' }), row('missed', 0, 20, { status: 'missed' }),
        ]);
        expect(activity).toMatchObject({ decisionCount: 1, executionCount: 2 });
    });
    it('recalculates outcomes and averages, but preserves P&L, fees, volume, and the equity endpoint', () => {
        const rows = [row('win', 0, 10), row('partial-loss', 2, 9, { pnl: -4, netPnl: -5 }), row('next', 11, 12)];
        const grouped = inferPositionActivity(rows).groupedTrades;
        const rawStats = computeDayStats(rows), groupedStats = computeDayStats(grouped);
        expect(rawStats).toMatchObject({ totalTrades: 3, winners: 2, losers: 1 });
        expect(groupedStats).toMatchObject({ totalTrades: 2, winners: 2, losers: 0, winRate: 100, avgNetPnl: 6.5 });
        for (const metric of ['netPnl', 'grossPnl', 'commissions', 'totalVolume'] as const) expect(groupedStats[metric]).toBe(rawStats[metric]);
        expect(buildEquityCurve(grouped, 25_000, 'exit').values).toEqual([25_000, 25_004, 25_013]);
        expect(buildEquityCurve(rows, 25_000, 'exit').values.at(-1)).toBe(25_013);
    });
    it('is deterministic for out-of-order inputs and leaves raw IDs intact', () => {
        const rows = [row('a', 0, 20), row('b', 5, 15), row('c', 25, 30)];
        expect(inferPositionActivity([...rows].reverse()).groupedTrades).toEqual(inferPositionActivity(rows).groupedTrades);
    });
});
