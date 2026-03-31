import { Component, Input, ViewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { TradeStats } from '../../../../core/models/trade.model';
import { SharePnlComponent, SharePnlStats } from '../../../../shared/components/share-pnl/share-pnl.component';

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

    get sharePnlStats(): SharePnlStats {
        return {
            winRate:     this.stats.winRate,
            totalTrades: this.stats.totalTrades,
            winners:     this.stats.winningTrades,
            losers:      this.stats.losingTrades,
            totalPoints: this.stats.totalPoints
        };
    }

    openShare(): void {
        this.sharePnl.open();
    }
}
