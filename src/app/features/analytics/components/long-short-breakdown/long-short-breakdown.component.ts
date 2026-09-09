import { Component, computed, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';
import {
    AnalyticsUnit,
    analyticsUnitLabel,
    buildAnalyticsObservations,
} from '../../utils/analytics-performance.utils';

interface SideStats {
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
}

@Component({
    selector: 'app-long-short-breakdown',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './long-short-breakdown.component.html',
    styleUrl: './long-short-breakdown.component.scss'
})
export class LongShortBreakdownComponent {
    readonly trades = input.required<Trade[]>();
    readonly unit = input<AnalyticsUnit>('decision');
    readonly unitLabel = computed(() => analyticsUnitLabel(this.unit()));

    breakdown = computed((): { long: SideStats; short: SideStats } => {
        const observations = buildAnalyticsObservations(this.trades(), this.unit());

        const calc = (dir: 'long' | 'short'): SideStats => {
            const group = observations.filter(observation => observation.direction === dir);
            const wins = group.filter(observation => observation.pnl > 0).length;
            const losses = group.filter(observation => observation.pnl < 0).length;
            const totalPnl = group.reduce((sum, observation) => sum + observation.pnl, 0);
            return {
                count: group.length,
                wins,
                losses,
                winRate: group.length > 0 ? Math.round(wins / group.length * 100) : 0,
                totalPnl,
                avgPnl: group.length > 0 ? totalPnl / group.length : 0
            };
        };

        return { long: calc('long'), short: calc('short') };
    });
}
