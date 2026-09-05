import { Trade } from '../../core/models/trade.model';
import {
    crossedPerformanceAlerts, DEFAULT_PERFORMANCE_ALERTS, parsePerformanceAlertPreferences,
    performanceMetrics, weekStartFor,
} from './performance-alerts.utils';

function trade(exitDate: string, pnl: number): Trade {
    return {
        id: exitDate + pnl, userId: 'A', symbol: 'NQ', assetType: 'futures', direction: 'long',
        entryDate: exitDate, exitDate, entryPrice: 1, exitPrice: 2, quantity: 1,
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
