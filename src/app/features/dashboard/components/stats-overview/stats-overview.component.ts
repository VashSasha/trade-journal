import { Component, Input, ViewChild, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { TradeStats } from '../../../../core/models/trade.model';
import { SharePnlComponent, SharePnlStats } from '../../../../shared/components/share-pnl/share-pnl.component';
import { FilterService } from '../../../../core/services/filter.service';

@Component({
    selector: 'app-stats-overview',
    standalone: true,
    imports: [CurrencyPipe, SharePnlComponent],
    templateUrl: './stats-overview.component.html',
    styleUrl: './stats-overview.component.scss'
})
export class StatsOverviewComponent {
    @Input({ required: true }) stats!: TradeStats;

    @ViewChild(SharePnlComponent) sharePnl!: SharePnlComponent;

    private filterService = inject(FilterService);

    get sharePnlStats(): SharePnlStats {
        return {
            winRate:     this.stats.winRate,
            totalTrades: this.stats.totalTrades,
            winners:     this.stats.winningTrades,
            losers:      this.stats.losingTrades,
            totalPoints: this.stats.totalPoints
        };
    }

    /**
     * Dashboard P&L reflects whatever date range is active in FilterService —
     * there's no single "day" to show, unlike the journal's day summary. This
     * turns that range into the label the share card prints in place of a date.
     */
    get sharePnlDateLabel(): string {
        const { start, end } = this.filterService.filters().dateRange;
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const sameDay = (a: Date, b: Date) =>
            a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

        if (!start && !end) return 'All Time';
        // "Today" (and any single-day pick) sets start/end to the same calendar
        // day with different times — show one date instead of a same-day range.
        if (start && end) return sameDay(start, end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
        if (start) return `From ${fmt(start)}`;
        return `Through ${fmt(end!)}`;
    }

    openShare(): void {
        this.sharePnl.open();
    }
}
