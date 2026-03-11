import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
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
        CurrencyPipe,
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

    // Equity Curve View
    equityView = signal<'trade' | 'hour' | 'day'>('trade');

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
                // Sync with filter service so trades from these accounts are shown
                this.updateFilterServiceAccounts(selected);
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

        // Sync with FilterService
        this.updateFilterServiceAccounts(newSelection);
    }

    private updateFilterServiceAccounts(ids: number[]) {
        // We need to update the filter service with the selected accounts
        // But FilterService expects string arrays. 
        // Also FilterService logic is "if empty, show all?" No, "if empty, show all" is usually handled by not filtering.
        // But here "Selected Account Ids" implies we ONLY show these.
        // If "Selected Account Ids" is empty, we show NONE? Or All?
        // Usually Dashboard header "Select Accounts" implies visibility.
        // Let's assume FilterService "accountIds" property works as: "if present, must match these". 

        // If all accounts are selected, maybe we clear the filter to mean "All"? 
        // Or strictly pass selected IDs. Passing selected IDs is safer.

        const stringIds = ids.map(id => id.toString());
        this.filterService.updateAccounts(stringIds);
    }

    selectAllAccounts() {
        const allIds = this.accounts().map(a => a.id);
        this.selectedAccountIds.set(allIds);
        this.tradovateService.setSelectedAccountIds(allIds);
        this.updateFilterServiceAccounts(allIds);
    }

    deselectAllAccounts() {
        this.selectedAccountIds.set([]);
        this.tradovateService.setSelectedAccountIds([]);
        this.updateFilterServiceAccounts([]);
    }

    setEquityView(view: 'trade' | 'hour' | 'day') {
        this.equityView.set(view);
    }

    // Filtered Trades
    filteredTrades = computed(() =>
        this.filterService.filterTrades(this.tradeService.trades())
    );

    // Stats (re-calculated based on filtered trades)
    stats = computed(() => this.tradeService.calculateStats(this.filteredTrades()));

    trades = this.filteredTrades;

    // Recent trades (last 5)
    recentTrades = computed(() => {
        return [...this.filteredTrades()]
            .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
            .slice(0, 5);
    });

    // Equity curve data for charts
    equityCurveData = computed(() => {
        const trades = this.filteredTrades()
            .filter(t => t.status === 'closed' && t.netPnl !== undefined)
            .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

        const view = this.equityView();

        let data: { date: string, rawDate: Date, pnl: number, timestamp: number }[] = [];

        // 1. Group Data based on View
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
                return {
                    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    rawDate: d,
                    pnl: pnl,
                    timestamp: d.getTime()
                };
            }).sort((a, b) => a.timestamp - b.timestamp);

        } else if (view === 'hour') {
            const groups = new Map<string, number>();
            trades.forEach(t => {
                const d = new Date(t.entryDate);
                // Round down to hour
                d.setMinutes(0, 0, 0);
                const key = d.toISOString();
                groups.set(key, (groups.get(key) || 0) + (t.netPnl || 0));
            });

            data = Array.from(groups.entries()).map(([iso, pnl]) => {
                const d = new Date(iso);
                return {
                    date: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }),
                    rawDate: d,
                    pnl: pnl,
                    timestamp: d.getTime()
                };
            }).sort((a, b) => a.timestamp - b.timestamp);
        }

        // 2. Calculate Cumulative
        let cumulative = 0;
        const labels: string[] = [];
        const values: number[] = [];

        data.forEach(d => {
            cumulative += d.pnl;
            labels.push(d.date);
            values.push(cumulative);
        });

        return { labels, values };
    });

}

