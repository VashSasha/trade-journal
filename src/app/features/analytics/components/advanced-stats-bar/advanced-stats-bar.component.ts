import { Component, computed, input } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';
import {
    AnalyticsUnit,
    analyticsUnitLabel,
    computeAnalyticsPerformance,
} from '../../utils/analytics-performance.utils';

@Component({
    selector: 'app-advanced-stats-bar',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe],
    templateUrl: './advanced-stats-bar.component.html',
    styleUrl: './advanced-stats-bar.component.scss'
})
export class AdvancedStatsBarComponent {
    readonly trades = input.required<Trade[]>();
    readonly unit = input<AnalyticsUnit>('decision');
    readonly unitTitle = computed(() => {
        const label = analyticsUnitLabel(this.unit(), false);
        return label.charAt(0).toUpperCase() + label.slice(1);
    });
    readonly stats = computed(() => computeAnalyticsPerformance(this.trades(), this.unit()));
}
