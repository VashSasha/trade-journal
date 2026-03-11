import { Component, inject, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { FilterToolbarComponent } from '../dashboard/components/filter-toolbar/filter-toolbar.component';
import { HourlyPerformanceComponent } from './components/hourly-performance/hourly-performance.component';

@Component({
    selector: 'app-analytics-dashboard',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, FilterToolbarComponent, HourlyPerformanceComponent],
    templateUrl: './analytics-dashboard.component.html'
})
export class AnalyticsDashboardComponent {
    private filterService = inject(FilterService);
    private tradeService = inject(TradeService);

    filteredTrades = computed(() => {
        return this.filterService.filterTrades(this.tradeService.trades());
    });
}
