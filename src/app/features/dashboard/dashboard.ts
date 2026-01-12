import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TradeService } from '../../core/services/trade.service';
import { TradovateService, TradovateAccount } from '../../core/services/tradovate.service';
import { SyncService } from '../../core/services/sync.service';
import { FilterService } from '../../core/services/filter.service';
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
        CommonModule,
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
    private tradovateService = inject(TradovateService);
    private syncService = inject(SyncService);
    private filterService = inject(FilterService);

    // Multi-Account Support
    accounts = signal<TradovateAccount[]>([]);
    accountBalances = signal<Map<number, number>>(new Map());
    selectedAccountIds = signal<number[]>([]);
    isBalancing = signal(false);
    showAccountDropdown = signal(false);

    // Computed aggregated balance
    aggregatedBalance = computed(() => {
        const selected = this.selectedAccountIds();
        const balances = this.accountBalances();
        let total = 0;
        selected.forEach(id => {
            total += balances.get(id) || 0;
        });
        return total;
    });

    ngOnInit(): void {
        this.loadAccounts();
        // Auto-load trades
        this.syncService.syncTrades().catch(err => {
            console.error('Dashboard auto-sync failed:', err);
        });
    }

    loadAccounts() {
        this.tradovateService.getAccounts().subscribe({
            next: (accounts) => {
                this.accounts.set(accounts);
                // Initialize selection from localStorage or select all
                this.tradovateService.initializeAccountSelection(accounts);
                const selected = this.tradovateService.getSelectedAccountIds();
                this.selectedAccountIds.set(selected);
                // Fetch balances for all accounts
                this.syncBalance();
            },
            error: (err) => {
                console.error('Failed to load accounts:', err);
            }
        });
    }

    syncBalance() {
        this.isBalancing.set(true);
        this.tradovateService.getCashBalances().subscribe({
            next: (balances: any[]) => {
                const balanceMap = new Map<number, number>();
                balances.forEach(b => {
                    if (b.accountId && b.amount !== undefined) {
                        balanceMap.set(b.accountId, b.amount);
                    }
                });
                this.accountBalances.set(balanceMap);
                this.isBalancing.set(false);
            },
            error: (err) => {
                console.error('Failed to fetch balance', err);
                this.isBalancing.set(false);
            }
        });
    }

    toggleAccountSelection(accountId: number) {
        const current = this.selectedAccountIds();
        const newSelection = current.includes(accountId)
            ? current.filter(id => id !== accountId)
            : [...current, accountId];
        this.selectedAccountIds.set(newSelection);
        this.tradovateService.setSelectedAccountIds(newSelection);
    }

    selectAllAccounts() {
        const allIds = this.accounts().map(a => a.id);
        this.selectedAccountIds.set(allIds);
        this.tradovateService.setSelectedAccountIds(allIds);
    }

    deselectAllAccounts() {
        this.selectedAccountIds.set([]);
        this.tradovateService.setSelectedAccountIds([]);
    }

    // Filtered Trades
    filteredTrades = computed(() => {
        return this.filterService.filterTrades(this.tradeService.trades());
    });

    // Stats (re-calculated based on filtered trades)
    stats = computed(() => {
        // We need to calculate stats manually or expose a helper in TradeService that accepts a list
        // For now, let's reuse the logic from TradeService but applied to filtered list
        return this.calculateStatsForTrades(this.filteredTrades());
    });

    trades = this.filteredTrades;

    // Recent trades (last 5)
    recentTrades = computed(() => {
        return [...this.filteredTrades()]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5);
    });

    // Equity curve data for charts
    equityCurveData = computed(() => {
        const trades = this.filteredTrades()
            .filter(t => t.status === 'closed')
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

    private calculateStatsForTrades(trades: any[]): any {
        // Exclude missed trades from active P&L stats
        const activeTrades = trades.filter(t => t.status !== 'missed');
        const closed = activeTrades.filter(t => t.status === 'closed');

        const winning = closed.filter(t => (t.netPnl || 0) > 0);
        const losing = closed.filter(t => (t.netPnl || 0) < 0);

        const totalPnl = closed.reduce((sum, t) => sum + (t.netPnl || 0), 0);
        const winningPnls = winning.map(t => t.netPnl || 0);
        const losingPnls = losing.map(t => t.netPnl || 0);

        // Calculate total points
        const totalPoints = closed.reduce((sum, t) => {
            if (!t.entryPrice || !t.exitPrice) return sum;
            const points = t.direction === 'long'
                ? t.exitPrice - t.entryPrice
                : t.entryPrice - t.exitPrice;
            return sum + points;
        }, 0);

        return {
            totalTrades: activeTrades.length,
            openTrades: activeTrades.filter(t => t.status === 'open').length,
            closedTrades: closed.length,
            totalPnl,
            totalPoints,
            winningTrades: winning.length,
            losingTrades: losing.length,
            winRate: closed.length > 0 ? (winning.length / closed.length) * 100 : 0,
            averageWin: winningPnls.length > 0
                ? winningPnls.reduce((a, b) => a + b, 0) / winningPnls.length
                : 0,
            averageLoss: losingPnls.length > 0
                ? losingPnls.reduce((a, b) => a + b, 0) / losingPnls.length
                : 0,
            largestWin: winningPnls.length > 0 ? Math.max(...winningPnls) : 0,
            largestLoss: losingPnls.length > 0 ? Math.min(...losingPnls) : 0
        };
    }
}

