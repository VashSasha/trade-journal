export type PnlDistributionTone = 'loss' | 'neutral' | 'profit';

export interface PnlDistributionBin {
    lower: number;
    upper: number;
    count: number;
    tone: PnlDistributionTone;
}

export interface PnlDistribution {
    count: number;
    bins: PnlDistributionBin[];
    median: number | null;
    lowerQuartile: number | null;
    upperQuartile: number | null;
    mean: number | null;
    topWinnerShare: number | null;
    topWinnerCount: number;
    winnerCount: number;
}

interface MutableBin extends PnlDistributionBin {
    losses: number;
    breakeven: number;
    profits: number;
}

const EMPTY_DISTRIBUTION: PnlDistribution = {
    count: 0,
    bins: [],
    median: null,
    lowerQuartile: null,
    upperQuartile: null,
    mean: null,
    topWinnerShare: null,
    topWinnerCount: 0,
    winnerCount: 0,
};

/**
 * Build equal-width, zero-aligned histogram buckets. Freedman-Diaconis keeps
 * larger samples honest around outliers; Sturges provides a stable fallback
 * when the sample has no interquartile spread.
 */
export function buildPnlDistribution(values: readonly number[]): PnlDistribution {
    const sorted = values
        .filter(value => Number.isFinite(value))
        .slice()
        .sort((left, right) => left - right);
    if (sorted.length === 0) return { ...EMPTY_DISTRIBUTION, bins: [] };

    const lowerQuartile = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const upperQuartile = quantile(sorted, 0.75);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const winners = sorted.filter(value => value > 0).sort((left, right) => right - left);
    const grossProfit = winners.reduce((sum, value) => sum + value, 0);
    const topWinnerCount = winners.length ? Math.max(1, Math.ceil(winners.length * 0.1)) : 0;
    const topWinnerShare = grossProfit > 0
        ? winners.slice(0, topWinnerCount).reduce((sum, value) => sum + value, 0) / grossProfit * 100
        : null;

    return {
        count: sorted.length,
        bins: histogramBins(sorted, lowerQuartile, upperQuartile),
        median,
        lowerQuartile,
        upperQuartile,
        mean,
        topWinnerShare,
        topWinnerCount,
        winnerCount: winners.length,
    };
}

function histogramBins(
    sorted: readonly number[],
    lowerQuartile: number,
    upperQuartile: number,
): PnlDistributionBin[] {
    const minimum = sorted[0];
    const maximum = sorted[sorted.length - 1];

    if (minimum === maximum) {
        const padding = Math.max(Math.abs(minimum) * 0.1, 1);
        const lower = minimum > 0 ? Math.max(0, minimum - padding) : minimum - padding;
        const upper = maximum < 0 ? Math.min(0, maximum + padding) : maximum + padding;
        return [{
            lower,
            upper,
            count: sorted.length,
            tone: minimum > 0 ? 'profit' : minimum < 0 ? 'loss' : 'neutral',
        }];
    }

    const lowerBoundary = Math.min(0, minimum);
    const upperBoundary = Math.max(0, maximum);
    const range = upperBoundary - lowerBoundary;
    const interquartileRange = upperQuartile - lowerQuartile;
    const fdWidth = interquartileRange > 0
        ? 2 * interquartileRange / Math.cbrt(sorted.length)
        : 0;
    const fallbackTarget = Math.ceil(Math.log2(sorted.length) + 1);
    const minimumTarget = sorted.length < 8 ? Math.max(3, sorted.length) : 8;
    const estimatedTarget = fdWidth > 0 ? Math.ceil(range / fdWidth) : fallbackTarget;
    // A zero boundary can add one bucket after alignment, hence the cap at 23.
    const target = Math.min(23, Math.max(minimumTarget, estimatedTarget));
    const width = range / target;
    const negativeCount = minimum < 0 ? safeCeil(Math.abs(minimum) / width) : 0;
    const hasBreakeven = sorted.some(value => value === 0);
    const positiveCount = maximum > 0
        ? safeCeil(maximum / width)
        : hasBreakeven ? 1 : 0;
    const alignedLower = -negativeCount * width;
    const binCount = negativeCount + positiveCount;

    const bins: MutableBin[] = Array.from({ length: binCount }, (_, index) => {
        const lower = alignedLower + index * width;
        const upper = lower + width;
        return {
            lower: nearZero(lower),
            upper: nearZero(upper),
            count: 0,
            tone: upper <= 0 ? 'loss' : lower >= 0 ? 'profit' : 'neutral',
            losses: 0,
            breakeven: 0,
            profits: 0,
        };
    });

    for (const value of sorted) {
        let index = value === 0 && positiveCount > 0
            ? negativeCount
            : Math.floor((value - alignedLower) / width);
        index = Math.max(0, Math.min(bins.length - 1, index));
        const bin = bins[index];
        bin.count++;
        if (value < 0) bin.losses++;
        else if (value > 0) bin.profits++;
        else bin.breakeven++;
    }

    return bins.map(({ losses, profits, count, lower, upper, breakeven }) => ({
        lower,
        upper,
        count,
        tone: profits > 0 && losses === 0
            ? 'profit'
            : losses > 0 && profits === 0
                ? 'loss'
                : breakeven > 0 && profits === 0 && losses === 0
                    ? 'neutral'
                    : upper <= 0 ? 'loss' : lower >= 0 ? 'profit' : 'neutral',
    }));
}

function quantile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * fraction;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const weight = position - lowerIndex;
    return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function safeCeil(value: number): number {
    return Math.max(1, Math.ceil(value - 1e-10));
}

function nearZero(value: number): number {
    return Math.abs(value) < 1e-10 ? 0 : value;
}
