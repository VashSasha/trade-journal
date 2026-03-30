import { Component, Input, inject } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Trade } from '../../../../../core/models/trade.model';
import { computeDayStats, buildEquityCurve, DayStats } from '../../../../../core/utils/trade-stats.utils';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { EquityCurveChartComponent } from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';

@Component({
    selector: 'app-day-summary',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule, EquityCurveChartComponent],
    templateUrl: './day-summary.component.html',
    styleUrl: './day-summary.component.scss'
})
export class DaySummaryComponent {
    @Input({ required: true }) trades!: Trade[];
    @Input() startBalance?: number;

    readonly accountSettings = inject(AccountSettingsService);

    get stats(): DayStats {
        return computeDayStats(this.trades);
    }

    get equityData() {
        const base = this.startBalance ?? this.accountSettings.startingBalance();
        return buildEquityCurve(this.trades, base);
    }
}