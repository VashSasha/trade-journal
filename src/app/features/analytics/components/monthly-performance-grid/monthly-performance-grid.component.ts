import { Component, computed, input } from '@angular/core';
import { Trade } from '../../../../core/models/trade.model';
import {
    AnalyticsUnit,
    MonthlyPerformance,
    analyticsUnitLabel,
    buildAnnualPerformance,
} from '../../utils/analytics-performance.utils';

const MONTH_LABELS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const COMPACT_CURRENCY = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
});

const FULL_CURRENCY = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

@Component({
    selector: 'app-monthly-performance-grid',
    standalone: true,
    templateUrl: './monthly-performance-grid.component.html',
    styleUrl: './monthly-performance-grid.component.scss',
})
export class MonthlyPerformanceGridComponent {
    readonly trades = input.required<readonly Trade[]>();
    readonly unit = input<AnalyticsUnit>('decision');

    readonly monthLabels = MONTH_LABELS;
    readonly rows = computed(() => buildAnnualPerformance(this.trades(), this.unit()));
    readonly unitLabel = computed(() => analyticsUnitLabel(this.unit()));

    formatCompactCurrency(value: number): string {
        return COMPACT_CURRENCY.format(value);
    }

    formatFullCurrency(value: number): string {
        return FULL_CURRENCY.format(value);
    }

    formatPercent(value: number): string {
        return `${Math.round(value)}%`;
    }

    unitCountLabel(count: number): string {
        return analyticsUnitLabel(this.unit(), count !== 1);
    }

    monthTone(month: MonthlyPerformance): string {
        if (!month.count) return 'empty';
        if (month.pnl === 0) return 'neutral';
        return `${month.pnl > 0 ? 'positive' : 'negative'}-${month.intensity}`;
    }

    monthSummary(month: MonthlyPerformance, year: number): string {
        const monthName = MONTH_LABELS[month.month];
        if (!month.count) return `${monthName} ${year}: no activity`;
        return `${monthName} ${year}: ${this.formatFullCurrency(month.pnl)}, ${month.count} ${this.unitCountLabel(month.count)}, ${this.formatPercent(month.winRate)} win rate`;
    }
}
