import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { TradeService } from '../../core/services/trade.service';
import { SyncService } from '../../core/services/sync.service';
import { FilterService } from '../../core/services/filter.service';
import { AccountService } from '../../core/services/account.service';
import { GoalsWidgetComponent } from './components/goals-widget/goals-widget.component';
import { StatsOverviewComponent } from './components/stats-overview/stats-overview.component';
import { PerformanceChartsComponent } from './components/performance-charts/performance-charts.component';
import { CalendarHeatmapComponent } from './components/calendar-heatmap/calendar-heatmap.component';
import { RecentTradesComponent } from './components/recent-trades/recent-trades.component';
import { FilterToolbarComponent } from './components/filter-toolbar/filter-toolbar.component';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [
        GoalsWidgetComponent,
        StatsOverviewComponent,
        PerformanceChartsComponent,
        CalendarHeatmapComponent,
        RecentTradesComponent,
        FilterToolbarComponent
    ],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit {
    private tradeService = inject(TradeService);
    private syncService = inject(SyncService);
    private filterService = inject(FilterService);
    private accountService = inject(AccountService);

    equityView = signal<'trade' | 'hour' | 'day'>('hour');

    ngOnInit(): void {
        const lastSync = this.syncService.lastSyncTime();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (!lastSync || lastSync.getTime() < fiveMinutesAgo) {
            this.syncService.syncTrades().catch(err => {
                console.error('Dashboard auto-sync failed:', err);
            });
        }
    }

    setEquityView(view: 'trade' | 'hour' | 'day') {
        this.equityView.set(view);
    }

    filteredTrades = computed(() =>
        this.filterService.filterTrades(this.tradeService.trades())
    );

    // Date-range-agnostic — used by the calendar, which manages its own month navigation
    calendarTrades = computed(() =>
        this.filterService.filterTradesIgnoreDateRange(this.tradeService.trades())
    );

    stats = computed(() => this.tradeService.calculateStats(this.filteredTrades()));

    recentTrades = computed(() =>
        [...this.filteredTrades()]
            .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
            .slice(0, 5)
    );


    equityCurveData = computed(() => {
        const trades = this.filteredTrades()
            .filter(t => t.status === 'closed' && t.netPnl !== undefined)
            .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

        const view = this.equityView();
        let data: { date: string, rawDate: Date, pnl: number, timestamp: number }[] = [];

        if (view === 'trade') {
            data = trades.map(t => ({
                date: new Date(t.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                rawDate: new Date(t.entryDate),
                pnl: t.netPnl || 0,
                timestamp: new Date(t.entryDate).getTime()
            }));
        } else if (view === 'day') {
            const groups = new Map<string, number>();
            trades.forEach(t => {
                const day = new Date(t.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                groups.set(day, (groups.get(day) || 0) + (t.netPnl || 0));
            });
            data = Array.from(groups.entries()).map(([dateStr, pnl]) => {
                const d = new Date(dateStr);
                return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), rawDate: d, pnl, timestamp: d.getTime() };
            }).sort((a, b) => a.timestamp - b.timestamp);
        } else if (view === 'hour') {
            const groups = new Map<string, number>();
            trades.forEach(t => {
                const d = new Date(t.entryDate);
                d.setMinutes(0, 0, 0);
                const key = d.toISOString();
                groups.set(key, (groups.get(key) || 0) + (t.netPnl || 0));
            });
            data = Array.from(groups.entries()).map(([iso, pnl]) => {
                const d = new Date(iso);
                return {
                    date: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }),
                    rawDate: d, pnl, timestamp: d.getTime()
                };
            }).sort((a, b) => a.timestamp - b.timestamp);
        }

        const filteredPnl = trades.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
        const startingBalance = this.accountService.aggregatedBalance() - filteredPnl;
        let cumulative = startingBalance;
        const labels: string[] = ['Start'];
        const values: number[] = [Math.round(startingBalance * 100) / 100];

        data.forEach(d => {
            cumulative += d.pnl;
            labels.push(d.date);
            values.push(Math.round(cumulative * 100) / 100);
        });

        return { labels, values };
    });
}
