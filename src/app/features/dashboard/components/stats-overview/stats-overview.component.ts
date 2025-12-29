import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TradeStats } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-stats-overview',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './stats-overview.component.html'
})
export class StatsOverviewComponent {
    @Input({ required: true }) stats!: TradeStats;

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(value);
    }
}
