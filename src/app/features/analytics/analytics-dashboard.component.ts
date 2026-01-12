import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { FilterToolbarComponent } from '../dashboard/components/filter-toolbar/filter-toolbar.component';
import { HourlyPerformanceComponent } from './components/hourly-performance/hourly-performance.component';

@Component({
    selector: 'app-analytics-dashboard',
    standalone: true,
    imports: [CommonModule, FilterToolbarComponent, HourlyPerformanceComponent],
    template: `
        <div class="min-h-full bg-slate-50 p-6 dark:bg-slate-950">
            <div class="mx-auto max-w-7xl">
                <!-- Header -->
                <div class="mb-6">
                    <h1 class="text-3xl font-bold text-slate-900 dark:text-white">Analytics</h1>
                    <p class="mt-1 text-slate-600 dark:text-slate-400">Deep dive into your trading data</p>
                </div>

                <!-- Shared Filter Toolbar -->
                <app-filter-toolbar></app-filter-toolbar>

                <!-- Analytics Content -->
                <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    
                    <!-- Hourly Performance Chart -->
                    <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <h3 class="font-bold text-slate-900 dark:text-white">Performance by Hour</h3>
                        <p class="text-sm text-slate-500 mb-4">Win Rate vs PnL</p>
                        <app-hourly-performance [trades]="filteredTrades()"></app-hourly-performance>
                    </div>

                    <!-- Setup Performance (Placeholder) -->
                    <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <h3 class="font-bold text-slate-900 dark:text-white">Performance by Setup</h3>
                        <p class="text-sm text-slate-500">Coming soon...</p>
                         <div class="mt-4 h-64 bg-slate-50 dark:bg-slate-800/50 rounded flex items-center justify-center text-slate-400">
                            Chart Placeholder
                        </div>
                    </div>

                </div>

                 <!-- Stats Summary Table -->
                <div class="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                    <div class="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                        <h3 class="font-bold text-slate-900 dark:text-white">Trade Log</h3>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm">
                            <thead class="bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                                <tr>
                                    <th class="px-6 py-3 font-medium">Date</th>
                                    <th class="px-6 py-3 font-medium">Symbol</th>
                                    <th class="px-6 py-3 font-medium">Side</th>
                                    <th class="px-6 py-3 font-medium text-right">PnL</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                                @for (trade of filteredTrades(); track trade.id) {
                                <tr>
                                    <td class="px-6 py-4 text-slate-900 dark:text-slate-200">{{ trade.entryDate | date:'shortDate' }}</td>
                                    <td class="px-6 py-4 font-medium text-slate-900 dark:text-white">{{ trade.symbol }}</td>
                                    <td class="px-6 py-4">
                                        <span [class.bg-emerald-100]="trade.direction === 'long'"
                                            [class.text-emerald-700]="trade.direction === 'long'"
                                            [class.bg-red-100]="trade.direction === 'short'"
                                            [class.text-red-700]="trade.direction === 'short'"
                                            class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize">
                                            {{ trade.direction }}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 text-right font-medium"
                                        [class.text-emerald-600]="(trade.netPnl || 0) >= 0"
                                        [class.text-red-600]="(trade.netPnl || 0) < 0">
                                        {{ trade.netPnl || 0 | currency }}
                                    </td>
                                </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `
})
export class AnalyticsDashboardComponent {
    private filterService = inject(FilterService);
    private tradeService = inject(TradeService);

    filteredTrades = computed(() => {
        return this.filterService.filterTrades(this.tradeService.trades());
    });
}
