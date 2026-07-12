import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { TradeService } from '../../core/services/trade.service';
import { SyncService } from '../../core/services/sync.service';
import { FilterService } from '../../core/services/filter.service';
import { AccountSettingsService } from '../../core/services/account-settings.service';
import { tradeSessionDateStr } from '../../core/utils/market-holidays';

function toDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
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
    private accountSettings = inject(AccountSettingsService);

    equityView = signal<'trade' | 'hour' | 'day'>('hour');

    ngOnInit(): void {
        // Always recompute netPnl from stored fees on load so stale localStorage
        // values (synced before fee logic existed) are corrected immediately,
        // without waiting for the next sync.
        this.tradeService.recalculateTradovateNetPnl(this.accountSettings.commissionPerContract());

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
            // P&L is realised at exit — sort by exitDate so the curve matches the
            // calendar and filter attribution (which also use exitDate).
            .sort((a, b) => new Date(a.exitDate ?? a.entryDate).getTime() - new Date(b.exitDate ?? b.entryDate).getTime());

        const view = this.equityView();
        let data: { date: string, rawDate: Date, pnl: number, timestamp: number }[] = [];

        if (view === 'trade') {
            data = trades.map(t => {
                const d = new Date(t.exitDate ?? t.entryDate);
                return {
                    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    rawDate: d,
                    pnl: t.netPnl || 0,
                    timestamp: d.getTime()
                };
            });
        } else if (view === 'day') {
            const groups = new Map<string, number>();
            trades.forEach(t => {
                const day = new Date(t.exitDate ?? t.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                groups.set(day, (groups.get(day) || 0) + (t.netPnl || 0));
            });
            data = Array.from(groups.entries()).map(([dateStr, pnl]) => {
                const d = new Date(dateStr);
                return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), rawDate: d, pnl, timestamp: d.getTime() };
            }).sort((a, b) => a.timestamp - b.timestamp);
        } else if (view === 'hour') {
            const groups = new Map<string, number>();
            trades.forEach(t => {
                const d = new Date(t.exitDate ?? t.entryDate);
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

        const startingBalance = this.accountSettings.startingBalance();

        // If a date range is active, offset the starting point by all P&L realised before it
        const dateRangeStart = this.filterService.filters().dateRange.start;
        let priorPnl = 0;
        if (dateRangeStart) {
            const startStr = toDateStr(dateRangeStart);
            priorPnl = this.filterService.filterTradesIgnoreDateRange(this.tradeService.trades())
                .filter(t => t.status === 'closed' && t.netPnl !== undefined)
                .filter(t => tradeSessionDateStr(t.exitDate ?? t.entryDate) < startStr)
                .reduce((sum, t) => sum + (t.netPnl || 0), 0);
        }

        let cumulative = startingBalance + priorPnl;
        const labels: string[] = ['Start'];
        const values: number[] = [Math.round(cumulative * 100) / 100];

        data.forEach(d => {
            cumulative += d.pnl;
            labels.push(d.date);
            values.push(Math.round(cumulative * 100) / 100);
        });

        return { labels, values };
    });
}
