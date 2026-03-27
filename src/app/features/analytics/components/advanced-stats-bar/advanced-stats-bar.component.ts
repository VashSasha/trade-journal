import { Component, computed, input } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-advanced-stats-bar',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe],
    templateUrl: './advanced-stats-bar.component.html',
    styleUrl: './advanced-stats-bar.component.scss'
})
export class AdvancedStatsBarComponent {
    trades = input.required<Trade[]>();

    stats = computed(() => {
        const closed = [...this.trades().filter(t => t.status === 'closed')]
            .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

        if (closed.length === 0) {
            return { profitFactor: 0, pfInfinite: false, maxDrawdown: 0, avgWin: 0, avgLoss: 0, bestStreak: 0, worstStreak: 0 };
        }

        const winners = closed.filter(t => (t.netPnl ?? 0) > 0);
        const losers  = closed.filter(t => (t.netPnl ?? 0) < 0);

        const grossWins   = winners.reduce((s, t) => s + (t.netPnl ?? 0), 0);
        const grossLosses = Math.abs(losers.reduce((s, t) => s + (t.netPnl ?? 0), 0));

        const pfInfinite   = grossLosses === 0 && grossWins > 0;
        const profitFactor = grossLosses === 0 ? 0 : +(grossWins / grossLosses).toFixed(2);
        const avgWin  = winners.length > 0 ? grossWins / winners.length : 0;
        const avgLoss = losers.length  > 0 ? -(grossLosses / losers.length) : 0;

        // Max drawdown (largest peak-to-trough drop in running equity)
        let equity = 0, peak = 0, maxDrawdown = 0;
        closed.forEach(t => {
            equity += (t.netPnl ?? 0);
            if (equity > peak) peak = equity;
            const dd = equity - peak;
            if (dd < maxDrawdown) maxDrawdown = dd;
        });

        // Win/loss streaks
        let bestStreak = 0, worstStreak = 0, curWin = 0, curLoss = 0;
        closed.forEach(t => {
            const pnl = t.netPnl ?? 0;
            if (pnl > 0) {
                curWin++; curLoss = 0;
                if (curWin > bestStreak) bestStreak = curWin;
            } else if (pnl < 0) {
                curLoss++; curWin = 0;
                if (curLoss > worstStreak) worstStreak = curLoss;
            } else {
                curWin = 0; curLoss = 0;
            }
        });

        return { profitFactor, pfInfinite, maxDrawdown, avgWin, avgLoss, bestStreak, worstStreak };
    });
}
