import { Component, inject, signal, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { FilterService } from '../../../../core/services/filter.service';
import { TradeService } from '../../../../core/services/trade.service';
import { TradovateService, TradovateAccount } from '../../../../core/services/tradovate.service';

@Component({
    selector: 'app-filter-toolbar',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './filter-toolbar.component.html'
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
