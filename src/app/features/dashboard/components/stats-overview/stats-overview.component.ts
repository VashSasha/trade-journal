import { Component, Input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { TradeStats } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-stats-overview',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './stats-overview.component.html',
    styleUrl: './stats-overview.component.scss'
})
export class StatsOverviewComponent {
    @Input({ required: true }) stats!: TradeStats;
}
