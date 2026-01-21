import { Component, Input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-calendar-heatmap',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './calendar-heatmap.component.html'
})
export class CalendarHeatmapComponent {
    protected readonly Math = Math;
    @Input({ required: true }) trades: Trade[] = [];

    currentDate = signal(new Date());

    // When trades input changes (if it was a signal passed in), we would react, 
    // but since it's a plain input we rely on parent change detection or ngOnChanges. 
    // However, Dashboard uses signals, so we might want to make this input a setter or signal if we want reactivity.
    // For now, let's assume standard change detection will handle rebuilds if trades change 
    // (creating a new array reference).

    calendarData = computed(() => {
        const current = this.currentDate();
        const year = current.getFullYear();
        const month = current.getMonth();

        // Group trades by date string (YYYY-MM-DD)
        const dailyStats = new Map<string, { pnl: number, count: number, pnlPercent: number }>();

        this.trades.forEach(trade => {
            // Use local date to avoid timezone issues (e.g. trading at 8pm should count for today, not tomorrow UTC)
            const d = new Date(trade.entryDate);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            const currentStats = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };

            if (trade.status === 'closed' && trade.netPnl !== undefined) {
                currentStats.pnl += trade.netPnl;
                if (trade.pnlPercent) {
                    currentStats.pnlPercent += trade.pnlPercent;
                }
            }
            currentStats.count++;
            dailyStats.set(dateStr, currentStats);
        });

        const days = [];
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();

        // Previous month days
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startPadding - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, prevMonthLastDay - i);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const dStr = String(date.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${dStr}`;

            const stats = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };
            days.push({
                date,
                day: date.getDate(),
                isCurrentMonth: false,
                pnl: stats.pnl,
                pnlPercent: stats.pnlPercent,
                count: stats.count,
                hasTrades: stats.count > 0,
                isToday: false
            });
        }

        // Current month days
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const date = new Date(year, month, i);
            const dateStr = date.toISOString().split('T')[0];
            const stats = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };
            days.push({
                date,
                day: i,
                isCurrentMonth: true,
                pnl: stats.pnl,
                pnlPercent: stats.pnlPercent,
                count: stats.count,
                hasTrades: stats.count > 0,
                isToday: new Date().toDateString() === date.toDateString()
            });
        }

        // Next month days
        const remainingCells = 42 - days.length;
        for (let i = 1; i <= remainingCells; i++) {
            const date = new Date(year, month + 1, i);
            const dateStr = date.toISOString().split('T')[0];
            const stats = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };
            days.push({
                date,
                day: i,
                isCurrentMonth: false,
                pnl: stats.pnl,
                pnlPercent: stats.pnlPercent,
                count: stats.count,
                hasTrades: stats.count > 0,
                isToday: false
            });
        }

        return days;
    });

    currentMonthYear = computed(() => {
        return this.currentDate().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    });

    nextMonth(): void {
        const current = this.currentDate();
        this.currentDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
    }

    prevMonth(): void {
        const current = this.currentDate();
        this.currentDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
    }

    today(): void {
        this.currentDate.set(new Date());
    }

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }
}
