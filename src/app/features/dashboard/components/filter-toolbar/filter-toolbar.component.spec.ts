import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { FilterToolbarComponent } from './filter-toolbar.component';
import { FilterService } from '../../../../core/services/filter.service';

describe('phone dashboard filters', () => {
    afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

    it('uses the same date/side actions as desktop and expands only on request', () => {
        const filters = { filters: signal({ sides: [] }), setDateRange: vi.fn(), toggleSide: vi.fn(), reset: vi.fn() };
        TestBed.configureTestingModule({ providers: [{ provide: FilterService, useValue: filters }] });
        const fixture = TestBed.createComponent(FilterToolbarComponent); fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
        select.value = 'today'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
        expect(fixture.componentInstance.activeDateFilter()).toBe('today');
        expect(filters.setDateRange).toHaveBeenLastCalledWith(expect.any(Date), expect.any(Date));
        const toggle = fixture.nativeElement.querySelector('button[aria-controls="dashboard-side-filters"]') as HTMLButtonElement;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click(); fixture.detectChanges();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        (fixture.nativeElement.querySelector('.filter-side-btn') as HTMLButtonElement).click();
        expect(filters.toggleSide).toHaveBeenCalledWith('long');
        select.value = 'custom'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
        expect(fixture.componentInstance.showCustomDatePicker()).toBe(true);
        expect(fixture.nativeElement.querySelectorAll('input[type="date"]')).toHaveLength(2);
    });

    function setup() {
        TestBed.configureTestingModule({ providers: [FilterService] });
        const fixture = TestBed.createComponent(FilterToolbarComponent); fixture.detectChanges();
        return { fixture, component: fixture.componentInstance, filters: TestBed.inject(FilterService) };
    }

    it('exposes selected date and direction controls and preserves selected accounts on reset', () => {
        const { fixture, component, filters } = setup();
        filters.updateAccounts(['account-1']);
        const root = fixture.nativeElement as HTMLElement;
        const presets = root.querySelectorAll<HTMLButtonElement>('.filter-preset');
        presets[1].click(); fixture.detectChanges();
        expect(presets[1].getAttribute('aria-pressed')).toBe('true');
        expect(presets[0].getAttribute('aria-pressed')).toBe('false');
        const side = root.querySelector<HTMLButtonElement>('.filter-side-btn')!;
        side.click(); fixture.detectChanges();
        expect(side.getAttribute('aria-pressed')).toBe('true');
        component.reset(); fixture.detectChanges();
        expect(filters.filters().accountIds).toEqual(['account-1']);
        expect(filters.filters().sides).toEqual([]);
        expect(presets[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('rejects incomplete or reversed custom dates without changing the applied range', () => {
        const { fixture, component, filters } = setup();
        component.setDateFilter('today');
        const before = filters.filters().dateRange;
        component.setDateFilter('custom'); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.filter-dates__apply').disabled).toBe(true);
        component.customStartDate.set('2026-09-20'); component.customEndDate.set('2026-09-01');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('End date');
        component.applyCustomDateRange();
        expect(filters.filters().dateRange).toEqual(before);
        expect(component.showCustomDatePicker()).toBe(true);
    });

    it('applies the selected local calendar days, including the full end day', () => {
        const { fixture, component, filters } = setup();
        component.setDateFilter('custom');
        component.customStartDate.set('2026-09-01'); component.customEndDate.set('2026-09-10');
        component.applyCustomDateRange(); fixture.detectChanges();
        expect(filters.filters().dateRange).toEqual({
            start: new Date(2026, 8, 1, 0, 0, 0, 0), end: new Date(2026, 8, 10, 23, 59, 59, 999),
        });
        expect(component.activeDateFilter()).toBe('custom');
        expect(component.showCustomDatePicker()).toBe(false);
        expect(component.customRangeLabel()).toBe('Sep 1, 2026 – Sep 10, 2026');
        component.setDateFilter('custom'); component.customStartDate.set('2026-08-01');
        fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(component.showCustomDatePicker()).toBe(false);
        expect(component.customRangeLabel()).toBe('Sep 1, 2026 – Sep 10, 2026');
    });
});
