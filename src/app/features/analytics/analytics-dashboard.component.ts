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

    equityCurveData = computed(() =>
        buildEquityCurve(this.filteredTrades(), this.accountSettings.startingBalance())
    );

    equityBaseline = computed(() => this.accountSettings.startingBalance());
}
