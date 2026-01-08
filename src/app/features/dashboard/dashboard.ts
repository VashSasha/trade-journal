import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TradeService } from '../../core/services/trade.service';
import { TradovateService } from '../../core/services/tradovate.service';
import { SyncService } from '../../core/services/sync.service';
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
export class DashboardComponent implements OnInit {
    private tradeService = inject(TradeService);
    private tradovateService = inject(TradovateService);
    private syncService = inject(SyncService);

    // Account Balance
    accountBalance = signal<number | null>(null);
    isBalancing = signal(false);

    ngOnInit(): void {
        this.syncBalance();
        // Auto-load trades
        this.syncService.syncTrades().catch(err => {
            console.error('Dashboard auto-sync failed:', err);
        });
    }

    syncBalance() {
        this.isBalancing.set(true);
        this.tradovateService.getCashBalances().subscribe({
            next: (balances: any[]) => {
                // Assuming the first balance is the primary one or summing them up.
                // Tradovate usually returns an array. Let's try to find 'totalCashValue' or sum 'amount'.
                // Using 'amount' from the first entry as a default for now.
                if (balances && balances.length > 0) {
                    const balance = balances[0].amount || 0;
                    this.accountBalance.set(balance);
                }
                this.isBalancing.set(false);
            },
            error: (err) => {
                console.error('Failed to fetch balance', err);
                this.isBalancing.set(false);
            }
        });
    }

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

