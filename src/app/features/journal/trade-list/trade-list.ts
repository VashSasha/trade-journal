import { Component, computed, inject, signal, DOCUMENT } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TradeService } from '../../../core/services/trade.service';
import { SyncService } from '../../../core/services/sync.service';
import { FilterService } from '../../../core/services/filter.service';
import { Trade } from '../../../core/models/trade.model';
import { TradeTableComponent } from '../../../shared/components/trade-table/trade-table.component';

type SortField = 'symbol' | 'assetType' | 'entryDate' | 'pnl' | 'status';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-trade-list',
    standalone: true,
    imports: [CurrencyPipe, RouterLink, TradeTableComponent],
    templateUrl: './trade-list.html',
    styleUrl: './trade-list.scss'
})
export class TradeListComponent {
    private tradeService = inject(TradeService);
    private syncService = inject(SyncService);
    private filterService = inject(FilterService);
    private document = inject(DOCUMENT);

    // Signals for filtering and sorting
    searchQuery = signal('');
    statusFilter = signal<'all' | 'open' | 'closed' | 'missed'>('all');
    visibleCount = signal(50);

    // Selection Logic
    selectedTradeIds = signal<Set<string>>(new Set());
    isAllSelected = computed(() => {
        const filtered = this.filteredTrades();
        return filtered.length > 0 && filtered.every(t => this.selectedTradeIds().has(t.id));
    });

    isImporting = this.syncService.isSyncing;

    constructor() { }

    async importTrades() {
        try {
            const count = await this.syncService.syncTrades();
            if (count > 0) {
                alert(`Successfully imported ${count} trades!`);
            } else {
                alert('No new trades found to import.');
            }
        } catch (err) {
            alert('Failed to import trades. Please check your settings.');
        }
    }
    sortField = signal<SortField>('entryDate');
    sortDirection = signal<SortDirection>('desc');

    // Get all trades from service
    allTrades = this.tradeService.trades;

    // Account-filtered trades (no search/status filter) — used for stats so they
    // reflect the selected account regardless of what's typed in the search box.
    private accountFilteredTrades = computed(() =>
        this.filterService.filterTradesIgnoreDateRange(this.allTrades())
    );

    // Filtered and sorted trades (account filter applied via FilterService)
    filteredTrades = computed(() => {
        let trades = this.filterService.filterTradesIgnoreDateRange(this.allTrades());

        // Filter by search query
        const query = this.searchQuery().toLowerCase();
        if (query) {
            trades = trades.filter(t =>
                t.symbol.toLowerCase().includes(query) ||
                t.setup?.toLowerCase().includes(query)
            );
        }

        // Filter by status
        const status = this.statusFilter();
        if (status !== 'all') {
            trades = trades.filter(t => t.status === status);
        }

        // Sort
        const field = this.sortField();
        const direction = this.sortDirection();

        trades = [...trades].sort((a, b) => {
            let aVal: any = a[field];
            let bVal: any = b[field];

            // Handle null/undefined
            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;

            // Compare
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        return trades;
    });

    visibleTrades = computed(() => this.filteredTrades().slice(0, this.visibleCount()));
    hasMore = computed(() => this.filteredTrades().length > this.visibleCount());

    // Stats derived from account-filtered trades so they match the table
    stats = computed(() => this.tradeService.calculateStats(this.accountFilteredTrades()));
    missedTradesCount = computed(() => this.accountFilteredTrades().filter(t => t.status === 'missed').length);

    setStatusFilter(status: 'all' | 'open' | 'closed' | 'missed'): void {
        this.statusFilter.set(status);
        this.visibleCount.set(50);
    }

    loadMore(): void {
        this.visibleCount.update(n => n + 50);
    }

    setSort(field: SortField): void {
        if (this.sortField() === field) {
            // Toggle direction
            this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortField.set(field);
            this.sortDirection.set('desc');
        }
    }

    onSearchInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.searchQuery.set(input.value);
        this.visibleCount.set(50);
    }

    deleteTrade(trade: Trade, event: Event): void {
        event.stopPropagation(); // Prevent row click if we add that later
        this.tradeService.deleteTrade(trade.id);
    }

    toggleSelection(id: string, event: Event): void {
        event.stopPropagation();
        const current = new Set(this.selectedTradeIds());
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        this.selectedTradeIds.set(current);
    }

    toggleAll(event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        const current = new Set(this.selectedTradeIds());
        const visibleTrades = this.filteredTrades();

        if (checked) {
            visibleTrades.forEach(t => current.add(t.id));
        } else {
            visibleTrades.forEach(t => current.delete(t.id));
        }
        this.selectedTradeIds.set(current);
    }

    deleteSelected(): void {
        if (!confirm(`Delete ${this.selectedTradeIds().size} trades?`)) return;

        this.tradeService.deleteTrades(this.selectedTradeIds());
        this.selectedTradeIds.set(new Set()); // Clear selection
    }

    exportSelected(): void {
        const ids = this.selectedTradeIds();
        const trades = this.allTrades().filter(t => ids.has(t.id));
        if (trades.length === 0) return;

        const headers = ['Date', 'Symbol', 'Type', 'Side', 'Status', 'Entry', 'Exit', 'Qty', 'PnL', 'Fees', 'Setup', 'Notes'];
        const csvContent = [
            headers.join(','),
            ...trades.map(t => [
                t.entryDate,
                t.symbol,
                t.assetType,
                t.direction,
                t.status,
                t.entryPrice,
                t.exitPrice || '',
                t.quantity,
                t.netPnl || 0,
                t.fees || 0,
                `"${t.setup?.replace(/"/g, '""') || ''}"`,
                `"${t.notes?.replace(/"/g, '""') || ''}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = this.document.createElement('a');
        a.href = url;
        a.download = `trades_export_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}
