import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Trade } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-recent-trades',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './recent-trades.component.html'
})
export class RecentTradesComponent {
    @Input({ required: true }) trades: Trade[] = [];

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }

    formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
}
