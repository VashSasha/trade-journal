import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { FilterToolbarComponent } from './filter-toolbar.component';
import { FilterService } from '../../../../core/services/filter.service';

describe('phone dashboard filters', () => {
    afterEach(() => TestBed.resetTestingModule());

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
});
