import { Component, Input, Output, EventEmitter, signal, inject, computed } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Trade, TradeGrade } from '../../../core/models/trade.model';
import { TradeService } from '../../../core/services/trade.service';

@Component({
    selector: 'app-trade-table',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink],
    templateUrl: './trade-table.component.html',
    styleUrl: './trade-table.component.scss'
})
export class TradeTableComponent {
    @Input({ required: true }) trades: Trade[] = [];
    /** Show the Date column (hide in daily journal — all trades are same day) */
    @Input() showDate = true;
    /** Show checkbox column for bulk selection */
    @Input() selectable = false;
    /** Currently selected IDs passed in from parent (when selectable=true) */
    @Input() selectedIds: Set<string> = new Set();
    @Output() selectedIdsChange = new EventEmitter<Set<string>>();

    private tradeService = inject(TradeService);

    readonly GRADES: TradeGrade[] = ['A', 'B', 'C', 'D'];
    activeGradePicker = signal<string | null>(null);

    isAllSelected = computed(() =>
        this.trades.length > 0 && this.trades.every(t => this.selectedIds.has(t.id))
    );

    // ── Grade picker ────────────────────────────────────────────────────────

    openGradePicker(tradeId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.activeGradePicker.set(this.activeGradePicker() === tradeId ? null : tradeId);
    }

    setGrade(tradeId: string, grade: TradeGrade | null, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.tradeService.updateTrade(tradeId, { grade: grade ?? undefined });
        this.activeGradePicker.set(null);
    }

    closePicker(): void {
        this.activeGradePicker.set(null);
    }

    // ── Selection ────────────────────────────────────────────────────────────

    toggleRow(id: string, event: Event): void {
        event.stopPropagation();
        const next = new Set(this.selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        this.selectedIdsChange.emit(next);
    }

    toggleAll(event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        const next = new Set(this.selectedIds);
        this.trades.forEach(t => checked ? next.add(t.id) : next.delete(t.id));
        this.selectedIdsChange.emit(next);
    }

    // ── Delete ───────────────────────────────────────────────────────────────

    deleteTrade(trade: Trade, event: Event): void {
        event.stopPropagation();
        if (confirm(`Delete trade ${trade.symbol}?`)) {
            this.tradeService.deleteTrade(trade.id);
        }
    }
}
