import { Component, Input, ViewChild, inject } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Trade } from '../../../../../core/models/trade.model';
import { computeDayStats, buildEquityCurve, DayStats } from '../../../../../core/utils/trade-stats.utils';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { EquityCurveChartComponent } from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { SharePnlComponent, SharePnlStats } from '../../../../../shared/components/share-pnl/share-pnl.component';

@Component({
    selector: 'app-day-summary',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule, EquityCurveChartComponent, SharePnlComponent],
    templateUrl: './day-summary.component.html',
    styleUrl: './day-summary.component.scss'
})
export class DaySummaryComponent {
    @Input({ required: true }) trades!: Trade[];
    @Input() startBalance?: number;
    @Input() date?: string;

    @ViewChild(SharePnlComponent) sharePnl!: SharePnlComponent;

    readonly accountSettings = inject(AccountSettingsService);

    get stats(): DayStats {
        return computeDayStats(this.trades);
    }

    get equityData() {
        const base = this.startBalance ?? this.accountSettings.startingBalance();
        return buildEquityCurve(this.trades, base);
    }

    get sharePnlStats(): SharePnlStats {
        const s = this.stats;
        return {
            winRate:     s.winRate,
            totalTrades: s.totalTrades,
            winners:     s.winners,
            losers:      s.losers
        };
    }

    openShare(): void {
        this.sharePnl.open();
    }
}