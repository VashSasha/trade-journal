import { Component, inject, computed } from '@angular/core';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { AccountSettingsService } from '../../core/services/account-settings.service';
import { FilterToolbarComponent } from '../dashboard/components/filter-toolbar/filter-toolbar.component';
import { EquityCurveChartComponent } from '../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { HourlyPerformanceComponent } from './components/hourly-performance/hourly-performance.component';
import { AdvancedStatsBarComponent } from './components/advanced-stats-bar/advanced-stats-bar.component';
import { LongShortBreakdownComponent } from './components/long-short-breakdown/long-short-breakdown.component';
import { PerformanceBySymbolComponent } from './components/performance-by-symbol/performance-by-symbol.component';
import { PerformanceByWeekdayComponent } from './components/performance-by-weekday/performance-by-weekday.component';
import { PerformanceBySetupComponent } from './components/performance-by-setup/performance-by-setup.component';
import { buildEquityCurve } from '../../core/utils/trade-stats.utils';

@Component({
    selector: 'app-analytics-dashboard',
    standalone: true,
    imports: [
        FilterToolbarComponent,
        EquityCurveChartComponent,
        HourlyPerformanceComponent,
        AdvancedStatsBarComponent,
        LongShortBreakdownComponent,
        PerformanceBySymbolComponent,
        PerformanceByWeekdayComponent,
        PerformanceBySetupComponent
    ],
    templateUrl: './analytics-dashboard.component.html',
    styleUrl: './analytics-dashboard.component.scss'
})
export class AnalyticsDashboardComponent {
    private filterService = inject(FilterService);
    private tradeService = inject(TradeService);
    private accountSettings = inject(AccountSettingsService);

    filteredTrades = computed(() =>
        this.filterService.filterTrades(this.tradeService.trades())
    );

    equityCurveData = computed(() => {
        const filtered = this.filteredTrades();
        const accountIds = this.filterService.filters().accountIds;

        const allClosed = this.tradeService.trades().filter(t => {
            if (t.status !== 'closed' || t.netPnl === undefined) return false;
            if (accountIds.length > 0 && t.accountId && t.accountId !== '0') {
                return accountIds.includes(t.accountId);
            }
            return true;
        });

        const firstDate = filtered.length > 0
            ? Math.min(...filtered.map(t => new Date(t.entryDate).getTime()))
            : Infinity;
        const priorPnl = allClosed
            .filter(t => new Date(t.entryDate).getTime() < firstDate)
            .reduce((sum, t) => sum + (t.netPnl ?? 0), 0);

        const adjustedStart = this.accountSettings.startingBalance() + priorPnl;
        return buildEquityCurve(filtered, adjustedStart);
    });

    equityBaseline = computed(() => this.accountSettings.startingBalance());
}
