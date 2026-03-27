import { Component, computed, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';

interface SideStats {
    count: number;
    wins: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
}

@Component({
    selector: 'app-long-short-breakdown',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './long-short-breakdown.component.html',
    styleUrl: './long-short-breakdown.component.scss'
})
export class LongShortBreakdownComponent {
    trades = input.required<Trade[]>();

    breakdown = computed((): { long: SideStats; short: SideStats } => {
        const closed = this.trades().filter(t => t.status === 'closed');

        const calc = (dir: 'long' | 'short'): SideStats => {
            const group = closed.filter(t => t.direction === dir);
            const wins = group.filter(t => (t.netPnl ?? 0) > 0).length;
            const totalPnl = group.reduce((s, t) => s + (t.netPnl ?? 0), 0);
            return {
                count: group.length,
                wins,
                winRate: group.length > 0 ? Math.round(wins / group.length * 100) : 0,
                totalPnl,
                avgPnl: group.length > 0 ? totalPnl / group.length : 0
            };
        };

        return { long: calc('long'), short: calc('short') };
    });
}
