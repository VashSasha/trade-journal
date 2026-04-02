import { Component, input, signal, computed, inject, HostListener, ElementRef } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Trade } from '../../../../core/models/trade.model';
import { EconomicCalendarService, EconomicEvent } from '../../../../core/services/economic-calendar.service';
import { isMarketClosed } from '../../../../core/utils/market-holidays';

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

        type DayStats = { pnl: number; pnlPercent: number; points: number; count: number; closedCount: number; wins: number };
        const dailyStats = new Map<string, DayStats>();

        this.trades().forEach(trade => {
            const dateStr = localDateStr(new Date(trade.entryDate));
            const s = dailyStats.get(dateStr) ?? { pnl: 0, pnlPercent: 0, points: 0, count: 0, closedCount: 0, wins: 0 };
            s.count++;
            if (trade.status === 'closed' && trade.netPnl !== undefined) {
                s.closedCount++;
                s.pnl += trade.netPnl;
                if (trade.pnlPercent) s.pnlPercent += trade.pnlPercent;
                if (trade.netPnl > 0) s.wins++;
                if (trade.exitPrice && trade.entryPrice) {
                    const diff = trade.direction === 'long'
                        ? trade.exitPrice - trade.entryPrice
                        : trade.entryPrice - trade.exitPrice;
                    s.points += diff * (trade.quantity || 1);
                }
            }
            dailyStats.set(dateStr, s);
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
            const s = dailyStats.get(dateStr) ?? { pnl: 0, pnlPercent: 0, points: 0, count: 0, closedCount: 0, wins: 0 };
            return {
                date, day: date.getDate(), isCurrentMonth,
                pnl: s.pnl, pnlPercent: s.pnlPercent, points: s.points,
                count: s.count, closedCount: s.closedCount, wins: s.wins,
                winRate: s.closedCount > 0 ? (s.wins / s.closedCount) * 100 : 0,
                hasTrades: s.count > 0,
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

    getDayBg(day: CalendarDay): string {
        if (!day.hasTrades || day.pnl === 0) return '';
        // Background always based on P&L regardless of selected display modes
        const opacity = 0.55 + Math.min(Math.abs(day.pnlPercent) / 5, 0.35);
        return day.pnl > 0 ? `rgba(16,185,129,${opacity})` : `rgba(239,68,68,${opacity})`;
    }

    formatSign(value: number): string {
        return value > 0 ? '+' : '';
    }
}
