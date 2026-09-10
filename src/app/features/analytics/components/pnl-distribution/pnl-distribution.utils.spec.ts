import { buildPnlDistribution } from './pnl-distribution.utils';

describe('buildPnlDistribution', () => {
    it('returns an empty model when no finite outcomes exist', () => {
        const result = buildPnlDistribution([Number.NaN, Number.POSITIVE_INFINITY]);

        expect(result).toMatchObject({ count: 0, bins: [], median: null });
    });

    it('computes robust center, range and profit concentration metrics', () => {
        const result = buildPnlDistribution([-100, -50, 0, 50, 100]);

        expect(result).toMatchObject({
            count: 5,
            lowerQuartile: -50,
            median: 0,
            upperQuartile: 50,
            mean: 0,
            topWinnerCount: 1,
            winnerCount: 2,
        });
        expect(result.topWinnerShare).toBeCloseTo(66.67, 1);
    });

    it('preserves every outcome and keeps loss and profit ranges split at zero', () => {
        const result = buildPnlDistribution([-420, -210, -80, -20, 0, 35, 90, 180, 760]);

        expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(result.count);
        expect(result.bins.length).toBeGreaterThanOrEqual(8);
        expect(result.bins.length).toBeLessThanOrEqual(24);
        expect(result.bins.every(bin =>
            bin.tone === 'neutral' || bin.upper <= 0 || bin.lower >= 0,
        )).toBe(true);
    });

    it('uses a single meaningful bucket when every outcome is identical', () => {
        const result = buildPnlDistribution([125, 125, 125]);

        expect(result.bins).toEqual([{
            lower: 112.5,
            upper: 137.5,
            count: 3,
            tone: 'profit',
        }]);
    });
});
