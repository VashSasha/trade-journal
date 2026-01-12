import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FilterService } from '../../../../core/services/filter.service';
import { TradeService } from '../../../../core/services/trade.service';
import { TradovateService, TradovateAccount } from '../../../../core/services/tradovate.service';

@Component({
    selector: 'app-filter-toolbar',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
        <div class="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <!-- Label -->
            <div class="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters:
            </div>

            <!-- Date Range (Standard Presets) -->
            <div class="flex items-center gap-2">
                <button (click)="setDateFilter('all')" 
                    [class.bg-slate-100]="activeDateFilter() === 'all'" 
                    [class.text-slate-900]="activeDateFilter() === 'all'"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    All Time
                </button>
                <button (click)="setDateFilter('today')" 
                    [class.bg-slate-100]="activeDateFilter() === 'today'" 
                    [class.text-slate-900]="activeDateFilter() === 'today'"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    Today
                </button>
                <button (click)="setDateFilter('week')" 
                    [class.bg-slate-100]="activeDateFilter() === 'week'" 
                    [class.text-slate-900]="activeDateFilter() === 'week'"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    This Week
                </button>
                <button (click)="setDateFilter('month')" 
                    [class.bg-slate-100]="activeDateFilter() === 'month'" 
                    [class.text-slate-900]="activeDateFilter() === 'month'"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    This Month
                </button>
                <div class="relative">
                    <button (click)="toggleCustomDatePicker()" 
                        [class.bg-indigo-100]="activeDateFilter() === 'custom'"
                        [class.text-indigo-700]="activeDateFilter() === 'custom'"
                        class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                        Custom
                    </button>

                    @if (showCustomDatePicker()) {
                        <div class="absolute left-0 top-full mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 z-50 p-4">
                            <div class="mb-3">
                                <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Start Date
                                </label>
                                <input 
                                    type="date" 
                                    [(ngModel)]="customStartDate"
                                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
                            </div>
                            <div class="mb-3">
                                <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    End Date
                                </label>
                                <input 
                                    type="date" 
                                    [(ngModel)]="customEndDate"
                                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
                            </div>
                            <div class="flex gap-2">
                                <button 
                                    (click)="applyCustomDateRange()"
                                    class="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                                    Apply
                                </button>
                                <button 
                                    (click)="showCustomDatePicker.set(false)"
                                    class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    }
                </div>
            </div>

            <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>

            <!-- Side -->
            <div class="flex items-center gap-2">
                 <button (click)="filterService.toggleSide('long')" 
                    [class.bg-emerald-100]="filterService.filters().sides.includes('long')"
                    [class.text-emerald-700]="filterService.filters().sides.includes('long')"
                    class="rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    Long
                </button>
                <button (click)="filterService.toggleSide('short')" 
                    [class.bg-red-100]="filterService.filters().sides.includes('short')"
                    [class.text-red-700]="filterService.filters().sides.includes('short')"
                    class="rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
                    Short
                </button>
            </div>

            <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>

            <!-- Account Filter -->
            <div class="relative">
                <button (click)="showAccountFilter.set(!showAccountFilter())" 
                    [class.bg-indigo-100]="filterService.filters().accountIds.length > 0"
                    [class.text-indigo-700]="filterService.filters().accountIds.length > 0"
                    class="rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800 flex items-center gap-1">
                    Accounts
                    @if (filterService.filters().accountIds.length > 0) {
                        <span class="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs text-white">{{filterService.filters().accountIds.length}}</span>
                    }
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                @if (showAccountFilter()) {
                    <div class="absolute left-0 top-full mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 z-50">
                        <div class="p-2 max-h-64 overflow-y-auto">
                            @for (account of availableAccounts(); track account.id) {
                                <label class="flex items-center gap-2 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                                    <input type="checkbox" 
                                        [checked]="filterService.filters().accountIds.includes(account.id.toString())"
                                        (change)="filterService.toggleAccount(account.id.toString())"
                                        class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span class="text-sm text-slate-900 dark:text-white">{{account.name}}</span>
                                </label>
                            } @empty {
                                <div class="p-2 text-center text-sm text-slate-500">
                                    No accounts available
                                </div>
                            }
                        </div>
                    </div>
                }
            </div>

            <!-- Reset -->
             <button (click)="reset()" 
                class="ml-auto text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                Reset
            </button>
        </div>
    `
})
export class FilterToolbarComponent implements OnInit {
    filterService = inject(FilterService);
    tradovateService = inject(TradovateService);

    // Track active date button state
    activeDateFilter = signal<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
    showAccountFilter = signal(false);
    availableAccounts = signal<TradovateAccount[]>([]);

    // Custom date picker
    showCustomDatePicker = signal(false);
    customStartDate = signal<string>('');
    customEndDate = signal<string>('');

    ngOnInit() {
        // Load available accounts for filtering
        this.tradovateService.getAccounts().subscribe({
            next: (accounts) => this.availableAccounts.set(accounts),
            error: (err) => console.error('Failed to load accounts for filter:', err)
        });
    }

    setDateFilter(type: 'all' | 'today' | 'week' | 'month' | 'custom') {
        if (type === 'custom') {
            this.showCustomDatePicker.set(true);
            return;
        }

        this.activeDateFilter.set(type);
        this.showCustomDatePicker.set(false);
        const now = new Date();

        // Reset time to start of day for accurate comparison
        now.setHours(0, 0, 0, 0);

        switch (type) {
            case 'all':
                this.filterService.setDateRange(null, null);
                break;
            case 'today':
                this.filterService.setDateRange(now, new Date());
                break;
            case 'week':
                const startOfWeek = new Date(now);
                startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
                this.filterService.setDateRange(startOfWeek, new Date());
                break;
            case 'month':
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                this.filterService.setDateRange(startOfMonth, new Date());
                break;
        }
    }

    toggleCustomDatePicker() {
        this.showCustomDatePicker.set(!this.showCustomDatePicker());
    }

    applyCustomDateRange() {
        const start = this.customStartDate();
        const end = this.customEndDate();

        if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            endDate.setHours(23, 59, 59, 999); // End of day

            this.filterService.setDateRange(startDate, endDate);
            this.activeDateFilter.set('custom');
            this.showCustomDatePicker.set(false);
        }
    }

    reset() {
        this.activeDateFilter.set('all');
        this.customStartDate.set('');
        this.customEndDate.set('');
        this.showCustomDatePicker.set(false);
        this.filterService.reset();
    }
}
