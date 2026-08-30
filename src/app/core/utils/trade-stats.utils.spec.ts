import { expect } from 'vitest';
import { buildEquityCurve, computeWindowedBalance } from './trade-stats.utils';
import type { Trade } from '../models/trade.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal closed Trade for use in tests. exitDate defaults to entryDate. */
function trade(
    netPnl: number,
    sessionDate: string,     // YYYY-MM-DD — stored at noon so session roll never fires
    overrides: Partial<Trade> = {}
): Trade {
    const iso = `${sessionDate}T12:00:00`;
    return {
        id: crypto.randomUUID(),
        userId: 'u1',
        symbol: 'ES',
        assetType: 'futures',
        direction: 'long',
        entryDate: iso,
        entryPrice: 5000,
        quantity: 1,
        exitDate: iso,
        status: 'closed',
        netPnl,
        createdAt: iso,
        updatedAt: iso,
        ...overrides,
    } as Trade;
}

// ── computeWindowedBalance ────────────────────────────────────────────────────

describe('computeWindowedBalance', () => {
    const BASE = 25_000;

    it('returns base unchanged when there are no trades', () => {
        expect(computeWindowedBalance(BASE, [], '2026-08-10')).toBe(BASE);
    });

    it('returns base unchanged when all trades fall ON the cutoff date', () => {
        const trades = [trade(500, '2026-08-10'), trade(200, '2026-08-10')];
        expect(computeWindowedBalance(BASE, trades, '2026-08-10')).toBe(BASE);
    });

    it('includes trades BEFORE the cutoff and excludes trades ON or AFTER it', () => {
        const trades = [
            trade(300, '2026-08-08'),   // before → included
            trade(200, '2026-08-09'),   // before → included
            trade(400, '2026-08-10'),   // ON cutoff → excluded
            trade(100, '2026-08-11'),   // after → excluded
        ];
        expect(computeWindowedBalance(BASE, trades, '2026-08-10')).toBe(BASE + 300 + 200);
    });

    it('handles losses (negative netPnl) correctly', () => {
        const trades = [
            trade(-500, '2026-08-08'),
            trade(200, '2026-08-09'),
        ];
        expect(computeWindowedBalance(BASE, trades, '2026-08-10')).toBe(BASE - 300);
    });

    it('skips open (non-closed) trades', () => {
        const openTrade = trade(999, '2026-08-08', { status: 'open', exitDate: undefined });
        expect(computeWindowedBalance(BASE, [openTrade], '2026-08-10')).toBe(BASE);
    });

    it('skips closed trades where netPnl is undefined', () => {
        const noNetPnl = trade(0, '2026-08-08', { netPnl: undefined });
        expect(computeWindowedBalance(BASE, [noNetPnl], '2026-08-10')).toBe(BASE);
    });

    it('uses exitDate when present for the session-date comparison', () => {
        // exitDate is '2026-08-09' (before cutoff) even though entryDate would be '2026-08-10'
        const t = trade(150, '2026-08-10', {
            entryDate: '2026-08-10T12:00:00',
            exitDate: '2026-08-09T12:00:00',
        });
        expect(computeWindowedBalance(BASE, [t], '2026-08-10')).toBe(BASE + 150);
    });

    it('a past-day baseline equals openingBalance + all prior P&L', () => {
        // Simulate three consecutive trading days leading up to Aug 10.
        const trades = [
            trade(400, '2026-08-07'),
            trade(-100, '2026-08-08'),
            trade(250, '2026-08-09'),
        ];
        // Balance at start of Aug 10 = 25000 + 400 - 100 + 250 = 25550
        expect(computeWindowedBalance(BASE, trades, '2026-08-10')).toBe(25_550);
    });

    it('curve-end minus baseline equals the day P&L (round-trip invariant)', () => {
        const dayPnl = 320;
        const dayTrades = [trade(dayPnl, '2026-08-10')];
        const priorTrades = [trade(200, '2026-08-09')];
        const allTrades = [...priorTrades, ...dayTrades];

        const baseline = computeWindowedBalance(BASE, allTrades, '2026-08-10');
        const curve = buildEquityCurve(dayTrades, baseline);

        // curve.values[0] is the baseline (Start), last value is baseline + dayPnl
        expect(curve.values[curve.values.length - 1] - curve.values[0]).toBeCloseTo(dayPnl);
    });
});

// ── buildEquityCurve ──────────────────────────────────────────────────────────

describe('buildEquityCurve', () => {
    it('starts with the given baseline and no trades → single point', () => {
        const { labels, values } = buildEquityCurve([], 25_000);
        expect(labels).toEqual(['Start']);
        expect(values).toEqual([25_000]);
    });

    it('flat day (0 netPnl trades) stays at the baseline — no red fill', () => {
        const { values } = buildEquityCurve([trade(0, '2026-08-10')], 25_000);
        expect(values[values.length - 1]).toBe(25_000);
    });

    it('cumulates correctly across multiple trades', () => {
        const trades = [trade(200, '2026-08-10'), trade(-100, '2026-08-10')];
        const { values } = buildEquityCurve(trades, 25_000);
        expect(values[values.length - 1]).toBe(25_100);
    });

    it('first value equals the startingBalance passed in', () => {
        const baseline = 24_500;
        const { values } = buildEquityCurve([trade(100, '2026-08-10')], baseline);
        expect(values[0]).toBe(baseline);
    });
});
