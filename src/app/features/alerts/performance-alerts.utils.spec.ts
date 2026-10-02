import { Trade } from '../../core/models/trade.model';
import {
    crossedPerformanceAlerts, DEFAULT_PERFORMANCE_ALERTS, parsePerformanceAlertPreferences,
    performanceMetrics, weekStartFor,
} from './performance-alerts.utils';

function trade(exitDate: string, pnl: number): Trade {
    return {
        id: exitDate + pnl, userId: 'A', accountId: 'one', symbol: 'NQ', assetType: 'futures', direction: 'long',
        entryDate: new Date(Date.parse(exitDate) - 60_000).toISOString(), exitDate, entryPrice: 1, exitPrice: 2, quantity: 1,
        netPnl: pnl, status: 'closed', createdAt: exitDate, updatedAt: exitDate,
    };
}

describe('performance alert preferences', () => {
    it('uses safe opt-in defaults and clamps persisted values', () => {
        expect(parsePerformanceAlertPreferences(null)).toEqual(DEFAULT_PERFORMANCE_ALERTS);
        const parsed = parsePerformanceAlertPreferences(JSON.stringify({
            dailyProfit: { enabled: true, value: -5 },
            dailyTrades: { enabled: true, value: 4.6 },
            weeklyLoss: { enabled: 'yes', value: 999999999 },
        }));
        expect(parsed.dailyProfit).toEqual({ enabled: true, value: 1 });
        expect(parsed.dailyTrades).toEqual({ enabled: true, value: 5 });
        expect(parsed.weeklyLoss).toEqual({ enabled: false, value: 10_000_000 });
    });
});

describe('performance alert evaluation', () => {
    it('uses grouped scale-ins/copies for the limit while keeping all account P&L', () => {
        const rows = ['one', 'two'].flatMap(accountId => [0, 1, 2].map(minute => ({
            ...trade('2026-08-04T15:00:00', 20), id: `${accountId}:${minute}`, accountId,
            entryDate: `2026-08-04T14:0${minute}:00`,
        })));
        expect(performanceMetrics(rows, new Date('2026-08-04T16:00:00'))).toMatchObject({ dailyTrades: 1, dailyPnl: 120 });
    });
    it('does not accuse the trader of a count-limit crossing with incomplete position data', () => {
        const prefs = parsePerformanceAlertPreferences(JSON.stringify({ dailyTrades: { enabled: true, value: 1 } }));
        const current = performanceMetrics([{ ...trade('2026-08-04T15:00:00', 20), accountId: undefined }], new Date('2026-08-04T16:00:00'));
        expect(current.tradeCountUncertain).toBe(true);
        expect(crossedPerformanceAlerts({ ...current, dailyTrades: 0 }, current, prefs)).toEqual([]);
    });
    it('keeps realized partial-exit P&L but pauses the count alert until a known open remainder is closed', () => {
        const partial = trade('2026-08-04T15:00:00', 20);
        const open = { ...partial, id: 'remaining', status: 'open' as const, exitDate: undefined };
        const now = new Date('2026-08-04T16:00:00');
        const current = performanceMetrics([partial, open], now);
        expect(current).toMatchObject({ dailyPnl: 20, dailyTrades: 1, tradeCountUncertain: true });
        const prefs = parsePerformanceAlertPreferences(JSON.stringify({ dailyTrades: { enabled: true, value: 1 } }));
        expect(crossedPerformanceAlerts({ ...current, dailyTrades: 0 }, current, prefs)).toEqual([]);
        expect(performanceMetrics([partial], now).tradeCountUncertain).toBeUndefined();
    });
    it('uses Monday as the week boundary and the CME session date for daily totals', () => {
        expect(weekStartFor('2026-08-05')).toBe('2026-08-03');
        const metrics = performanceMetrics([
            trade('2026-08-04T14:00:00', 200),
            // After 5pm local is attributed to Aug 5.
            trade('2026-08-04T18:00:00', -50),
            trade('2026-08-02T14:00:00', 999),
        ], new Date('2026-08-04T19:00:00'));
        expect(metrics).toEqual({ day: '2026-08-05', week: '2026-08-03', dailyPnl: -50, weeklyPnl: 150, dailyTrades: 1 });
    });

    it('reports each configured crossing with risk alerts first', () => {
        const preferences = parsePerformanceAlertPreferences(JSON.stringify({
            dailyProfit: { enabled: true, value: 500 },
            dailyLoss: { enabled: true, value: 300 },
            weeklyProfit: { enabled: true, value: 1000 },
            weeklyLoss: { enabled: false, value: 750 },
            dailyTrades: { enabled: true, value: 10 },
        }));
        const base = { day: '2026-08-05', week: '2026-08-03', dailyPnl: 450, weeklyPnl: 900, dailyTrades: 9 };
        expect(crossedPerformanceAlerts(base, { ...base, dailyPnl: 550, weeklyPnl: 1050, dailyTrades: 10 }, preferences)
            .map(alert => alert.rule)).toEqual(['dailyTrades', 'dailyProfit', 'weeklyProfit']);
        expect(crossedPerformanceAlerts({ ...base, dailyPnl: -250 }, { ...base, dailyPnl: -350 }, preferences)[0])
            .toMatchObject({ rule: 'dailyLoss', tone: 'risk' });
    });

    it('does not replay a prior day or week', () => {
        const preferences = parsePerformanceAlertPreferences(JSON.stringify({ dailyProfit: { enabled: true, value: 500 } }));
        const previous = { day: '2026-08-04', week: '2026-08-03', dailyPnl: 0, weeklyPnl: 0, dailyTrades: 0 };
        const current = { day: '2026-08-05', week: '2026-08-03', dailyPnl: 600, weeklyPnl: 600, dailyTrades: 1 };
        expect(crossedPerformanceAlerts(previous, current, preferences)).toEqual([]);
    });
});
