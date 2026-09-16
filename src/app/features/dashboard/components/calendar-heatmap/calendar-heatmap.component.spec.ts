import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarHeatmapComponent } from './calendar-heatmap.component';
import { EconomicCalendarService } from '../../../../core/services/economic-calendar.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { Trade } from '../../../../core/models/trade.model';

describe('compact dashboard calendar', () => {
    afterEach(() => TestBed.resetTestingModule());

    function setup() {
        TestBed.configureTestingModule({ providers: [
            { provide: EconomicCalendarService, useValue: { getEventsForMonth: () => [] } },
            { provide: ThemeService, useValue: { isDark: () => true } },
        ] });
        const fixture = TestBed.createComponent(CalendarHeatmapComponent);
        fixture.componentInstance.currentDate.set(new Date(2026, 8, 1));
        const trade = { id: 't1', status: 'closed', direction: 'long', entryDate: '2026-09-09T12:00:00',
            exitDate: '2026-09-09T12:00:00', quantity: 1, netPnl: -1754.25, pnlPercent: -1.2 } as Trade;
        fixture.componentRef.setInput('trades', [trade]);
        fixture.detectChanges();
        return { fixture, trade };
    }

    it('shows exact values after tapping an abbreviated day and reacts to account/filter changes', () => {
        const { fixture, trade } = setup();
        const button = fixture.nativeElement.querySelector('button[aria-label*="September 9, 2026"]') as HTMLButtonElement;
        expect(button.getAttribute('aria-label')).toContain('-$1,754.25');
        button.click(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.cal-mobile-detail').textContent).toContain('-$1,754.25');
        fixture.componentRef.setInput('trades', [{ ...trade, netPnl: 200.05 }]); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.cal-mobile-detail').textContent).toContain('$200.05');
        fixture.componentRef.setInput('trades', []); fixture.detectChanges();
        expect(fixture.componentInstance.selectedDay()?.stats.totalTrades).toBe(0);
    });

    it('renders 42 accessible dates and clears out-of-month selection when navigating', () => {
        const { fixture } = setup();
        expect(fixture.nativeElement.querySelectorAll('.cal-day__compact')).toHaveLength(42);
        fixture.componentInstance.selectDay(fixture.componentInstance.calendarData()[10]);
        (fixture.nativeElement.querySelector('button[aria-label="Next month"]') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(fixture.componentInstance.selectedDay()).toBeUndefined();
        expect(fixture.componentInstance.compact(-1754.25)).toBe('-1.8K');
        expect(fixture.componentInstance.compact(0)).toBe('0');
    });
});
