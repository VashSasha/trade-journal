import { Component, input, signal, computed, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';
import { EconomicCalendarService, EconomicEvent } from '../../../../core/services/economic-calendar.service';
import { isMarketClosed } from '../../../../core/utils/market-holidays';

interface CalendarDay {
    date: Date;
    day: number;
    isCurrentMonth: boolean;
    pnl: number;
    pnlPercent: number;
    count: number;
    hasTrades: boolean;
    isToday: boolean;
    isMarketClosed: boolean;
    events: EconomicEvent[];
}

function localDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

@Component({
    selector: 'app-calendar-heatmap',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './calendar-heatmap.component.html',
    styleUrl: './calendar-heatmap.component.scss'
})
export class CalendarHeatmapComponent {
    protected readonly Math = Math;
    trades = input.required<Trade[]>();

    private economicCalendarService = inject(EconomicCalendarService);

    currentDate = signal(new Date());

    calendarData = computed((): CalendarDay[] => {
        const current = this.currentDate();
        const year = current.getFullYear();
        const month = current.getMonth();

        // Group trades by local date string
        const dailyStats = new Map<string, { pnl: number; count: number; pnlPercent: number }>();
        this.trades().forEach(trade => {
            const dateStr = localDateStr(new Date(trade.entryDate));
            const s = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };
            if (trade.status === 'closed' && trade.netPnl !== undefined) {
                s.pnl += trade.netPnl;
                if (trade.pnlPercent) s.pnlPercent += trade.pnlPercent;
            }
            s.count++;
            dailyStats.set(dateStr, s);
        });

        // Economic events for this month (and adjacent months for padding days)
        const eventsThisMonth = this.economicCalendarService.getEventsForMonth(year, month);
        const eventsPrevMonth = this.economicCalendarService.getEventsForMonth(
            month === 0 ? year - 1 : year,
            month === 0 ? 11 : month - 1
        );
        const eventsNextMonth = this.economicCalendarService.getEventsForMonth(
            month === 11 ? year + 1 : year,
            month === 11 ? 0 : month + 1
        );

        const eventsMap = new Map<string, EconomicEvent[]>();
        [...eventsPrevMonth, ...eventsThisMonth, ...eventsNextMonth].forEach(e => {
            const arr = eventsMap.get(e.date) || [];
            arr.push(e);
            eventsMap.set(e.date, arr);
        });

        const makeDay = (date: Date, isCurrentMonth: boolean, isToday: boolean): CalendarDay => {
            const dateStr = localDateStr(date);
            const s = dailyStats.get(dateStr) || { pnl: 0, count: 0, pnlPercent: 0 };
            return {
                date,
                day: date.getDate(),
                isCurrentMonth,
                pnl: s.pnl,
                pnlPercent: s.pnlPercent,
                count: s.count,
                hasTrades: s.count > 0,
                isToday,
                isMarketClosed: isMarketClosed(date),
                events: eventsMap.get(dateStr) || []
            };
        };

        const days: CalendarDay[] = [];
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        const today = new Date();

        for (let i = startPadding - 1; i >= 0; i--) {
            days.push(makeDay(new Date(year, month - 1, prevMonthLastDay - i), false, false));
        }
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const date = new Date(year, month, i);
            days.push(makeDay(date, true, today.toDateString() === date.toDateString()));
        }
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push(makeDay(new Date(year, month + 1, i), false, false));
        }

        return days;
    });

    currentMonthYear = computed(() =>
        this.currentDate().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    );

    nextMonth(): void {
        const c = this.currentDate();
        this.currentDate.set(new Date(c.getFullYear(), c.getMonth() + 1, 1));
    }

    prevMonth(): void {
        const c = this.currentDate();
        this.currentDate.set(new Date(c.getFullYear(), c.getMonth() - 1, 1));
    }

    today(): void {
        this.currentDate.set(new Date());
    }

    getDayBg(day: CalendarDay): string {
        if (!day.hasTrades || day.pnl === 0) return '';
        const opacity = 0.5 + Math.min(Math.abs(day.pnlPercent) / 5, 0.5);
        return day.pnl > 0
            ? `rgba(16, 185, 129, ${opacity})`
            : `rgba(239, 68, 68, ${opacity})`;
    }
}
