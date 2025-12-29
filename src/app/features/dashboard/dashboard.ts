import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TradeService } from '../../core/services/trade.service';
import { GoalsWidgetComponent } from './components/goals-widget/goals-widget.component';
import { StatsOverviewComponent } from './components/stats-overview/stats-overview.component';
import { PerformanceChartsComponent } from './components/performance-charts/performance-charts.component';
import { CalendarHeatmapComponent } from './components/calendar-heatmap/calendar-heatmap.component';
import { RecentTradesComponent } from './components/recent-trades/recent-trades.component';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        GoalsWidgetComponent,
        StatsOverviewComponent,
        PerformanceChartsComponent,
        CalendarHeatmapComponent,
        RecentTradesComponent
    ],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.scss'
})
export class DashboardComponent {
    private tradeService = inject(TradeService);

    // Stats
    stats = this.tradeService.stats;
    trades = this.tradeService.trades; // Pass all trades to calendar/heatmap

    // Recent trades (last 5)
    recentTrades = computed(() => {
        return [...this.tradeService.trades()]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5);
    });

    // Equity curve data for charts
    equityCurveData = computed(() => {
        const trades = [...this.tradeService.closedTrades()]
            .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

        let cumulative = 0;
        const data = trades.map(t => {
            cumulative += t.netPnl || 0;
            return {
                date: new Date(t.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                value: cumulative
            };
        });

        return {
            labels: data.map(d => d.date),
            values: data.map(d => d.value)
        };
    });
}

