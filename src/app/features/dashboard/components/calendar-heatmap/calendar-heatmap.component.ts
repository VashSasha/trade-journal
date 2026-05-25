import { Component, input, signal, computed, inject, HostListener, ElementRef } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';
import { EconomicCalendarService, EconomicEvent } from '../../../../core/services/economic-calendar.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { isMarketClosed, tradeSessionDateStr } from '../../../../core/utils/market-holidays';
import { computeDayStats } from '../../../../core/utils/trade-stats.utils';

export type CalDisplayMode = 'pnl' | 'points' | 'trades' | 'winrate' | 'percent';

interface CalendarDay {
    date: Date;
    day: number;
    isCurrentMonth: boolean;
    pnl: number;
    pnlPercent: number;
    points: number;
    count: number;
    closedCount: number;
    wins: number;
    losses: number;
    winRate: number;
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

const STORAGE_KEY = 'cal_selected_modes';
// Priority order for background coloring (first selected directional mode wins)
const BG_PRIORITY: CalDisplayMode[] = ['pnl', 'points', 'percent', 'winrate'];

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
    private theme = inject(ThemeService);
    private elRef = inject(ElementRef);

    currentDate = signal(new Date());
    settingsOpen = signal(false);

    selectedModes = signal<CalDisplayMode[]>((() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : ['pnl'];
        } catch { return ['pnl']; }
    })());

    readonly modeOptions: { value: CalDisplayMode; label: string }[] = [
        { value: 'pnl',     label: 'Daily P&L' },
        { value: 'points',  label: 'Points' },
        { value: 'trades',  label: '# Trades' },
        { value: 'winrate', label: 'Win Rate' },
        { value: 'percent', label: '% Gain' },
    ];

    calendarData = computed((): CalendarDay[] => {
        const current = this.currentDate();
        const year = current.getFullYear();
        const month = current.getMonth();

        const tradesByDay = new Map<string, Trade[]>();
        this.trades().forEach(trade => {
            // Group closed trades by exitDate so P&L is attributed to the day it was realized,
            // matching Tradovate's Performance report. Open trades fall back to entryDate.
            // Apply the 5 PM session cutoff: trades at/after 17:00 local belong to the next day.
            const dateKey = (trade.status === 'closed' && trade.exitDate) ? trade.exitDate : trade.entryDate;
            const dateStr = tradeSessionDateStr(dateKey);
            const bucket = tradesByDay.get(dateStr) ?? [];
            bucket.push(trade);
            tradesByDay.set(dateStr, bucket);
        });

        const eventsThisMonth = this.economicCalendarService.getEventsForMonth(year, month);
        const eventsPrevMonth = this.economicCalendarService.getEventsForMonth(
            month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1
        );
        const eventsNextMonth = this.economicCalendarService.getEventsForMonth(
            month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1
        );

        const eventsMap = new Map<string, EconomicEvent[]>();
        [...eventsPrevMonth, ...eventsThisMonth, ...eventsNextMonth].forEach(e => {
            const arr = eventsMap.get(e.date) || [];
            arr.push(e);
            eventsMap.set(e.date, arr);
        });

        const makeDay = (date: Date, isCurrentMonth: boolean, isToday: boolean): CalendarDay => {
            const dateStr = localDateStr(date);
            const dayTrades = tradesByDay.get(dateStr) ?? [];
            const ds = computeDayStats(dayTrades);

            let points = 0;
            dayTrades.filter(t => t.status === 'closed').forEach(t => {
                if (t.exitPrice && t.entryPrice) {
                    const diff = t.direction === 'long'
                        ? t.exitPrice - t.entryPrice
                        : t.entryPrice - t.exitPrice;
                    points += diff * (t.quantity || 1);
                }
            });

            let pnlPercent = 0;
            dayTrades.forEach(t => { if (t.pnlPercent) pnlPercent += t.pnlPercent; });

            const winRate = (ds.winners + ds.losers) > 0
                ? (ds.winners / (ds.winners + ds.losers)) * 100
                : 0;

            return {
                date, day: date.getDate(), isCurrentMonth,
                pnl: ds.netPnl,
                pnlPercent,
                points,
                count: dayTrades.length,
                closedCount: ds.totalTrades,
                wins: ds.winners,
                losses: ds.losers,
                winRate,
                hasTrades: dayTrades.length > 0,
                isToday, isMarketClosed: isMarketClosed(date),
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

    isSelected(mode: CalDisplayMode): boolean {
        return this.selectedModes().includes(mode);
    }

    toggleMode(mode: CalDisplayMode): void {
        const current = this.selectedModes();
        const next = current.includes(mode)
            ? current.filter(m => m !== mode)
            : [...current, mode];
        if (next.length === 0) return; // always keep at least one
        this.selectedModes.set(next);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    }

    toggleSettings(): void {
        this.settingsOpen.update(v => !v);
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (this.settingsOpen() && !this.elRef.nativeElement.contains(event.target)) {
            this.settingsOpen.set(false);
        }
    }

    isCellColored(day: CalendarDay): boolean {
        return day.hasTrades && day.pnl !== 0;
    }

    getCellOpacity(day: CalendarDay): number {
        if (!day.hasTrades || day.pnl === 0) return 0;
        const isDark = this.theme.isDark();
        if (day.pnl > 0) {
            return isDark
                ? 0.40 + Math.min(Math.abs(day.pnlPercent) / 5, 0.30)
                : 0.20 + Math.min(Math.abs(day.pnlPercent) / 5, 0.28);
        }
        return 0.78 + Math.min(Math.abs(day.pnlPercent) / 5, 0.22);
    }

    formatSign(value: number): string {
        return value > 0 ? '+' : '';
    }
}
