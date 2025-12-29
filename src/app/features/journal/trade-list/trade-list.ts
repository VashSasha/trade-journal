import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TradeService } from '../../../core/services/trade.service';
import { SyncService } from '../../../core/services/sync.service';
import { Trade, TradeStatus } from '../../../core/models/trade.model';

type SortField = 'symbol' | 'entryDate' | 'pnl' | 'status';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-trade-list',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './trade-list.html',
    styles: []
})
export class TradeListComponent {
    private tradeService = inject(TradeService);
    private syncService = inject(SyncService);
    private router = inject(Router);

    // Signals for filtering and sorting
    searchQuery = signal('');
    statusFilter = signal<'all' | 'open' | 'closed' | 'missed'>('all');

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

    // Filtered and sorted trades
    filteredTrades = computed(() => {
        let trades = this.allTrades();

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

    // Stats
    stats = this.tradeService.stats;
    missedTradesCount = computed(() => this.allTrades().filter(t => t.status === 'missed').length);

    setStatusFilter(status: 'all' | 'open' | 'closed' | 'missed'): void {
        this.statusFilter.set(status);
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
    }

    formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(value);
    }

    deleteTrade(trade: Trade, event: Event): void {
        event.stopPropagation(); // Prevent row click if we add that later
        this.tradeService.deleteTrade(trade.id);
    }

    viewTrade(trade: Trade): void {
        this.router.navigate(['/journal/trade', trade.id]);
    }
}
