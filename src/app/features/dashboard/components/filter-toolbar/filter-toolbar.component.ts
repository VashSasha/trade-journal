import { Component, computed, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { FilterService } from '../../../../core/services/filter.service';

@Component({
    selector: 'app-filter-toolbar',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './filter-toolbar.component.html',
    styleUrl: './filter-toolbar.component.scss'
})
export class FilterToolbarComponent {
    filterService = inject(FilterService);
    private readonly customTrigger = viewChild<ElementRef<HTMLButtonElement>>('customTrigger');
    private readonly mobileDate = viewChild<ElementRef<HTMLSelectElement>>('mobileDate');
    readonly datePresets = [
        { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
        { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' },
    ] as const;

    activeDateFilter = signal<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
    readonly mobileFiltersOpen = signal(false);

    toggleMobileFilters(): void {
        this.mobileFiltersOpen.update(open => !open);
    }

    selectMobileDate(value: string): void {
        if (value === 'all' || value === 'today' || value === 'week' || value === 'month' || value === 'custom') {
            this.setDateFilter(value);
        }
    }

    constructor() {
        this.setDateFilter('all');
    }

    // Custom date picker
    showCustomDatePicker = signal(false);
    customStartDate = signal<string>('');
    customEndDate = signal<string>('');
    readonly dateRangeError = computed(() => this.customStartDate() && this.customEndDate()
        && this.customStartDate() > this.customEndDate() ? 'End date must be on or after start date.' : null);
    readonly canApplyCustomRange = computed(() => Boolean(this.customStartDate() && this.customEndDate()
        && !this.dateRangeError()
        && Number.isFinite(Date.parse(this.customStartDate() + 'T00:00:00'))
        && Number.isFinite(Date.parse(this.customEndDate() + 'T00:00:00'))));
    readonly customRangeLabel = computed(() => {
        const format = (value: Date) => value.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
        const { start, end } = this.filterService.filters().dateRange;
        if (!start || !end) return '';
        // Use applied dates, not draft inputs changed before Cancel.
        return start.toDateString() === end.toDateString()
            ? format(start) : `${format(start)} – ${format(end)}`;
    });

    @HostListener('keydown.escape')
    closeCustomDatePicker(): void {
        if (!this.showCustomDatePicker()) return;
        this.showCustomDatePicker.set(false);
        const trigger = this.customTrigger()?.nativeElement;
        (trigger?.getClientRects().length ? trigger : this.mobileDate()?.nativeElement)?.focus();
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

        if (this.canApplyCustomRange()) {
            // Date-only strings otherwise parse as UTC and shift the chosen day west of UTC.
            const startDate = new Date(start + 'T00:00:00');
            const endDate = new Date(end + 'T00:00:00');
            endDate.setHours(23, 59, 59, 999); // End of day

            this.filterService.setDateRange(startDate, endDate);
            this.activeDateFilter.set('custom');
            this.closeCustomDatePicker();
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
