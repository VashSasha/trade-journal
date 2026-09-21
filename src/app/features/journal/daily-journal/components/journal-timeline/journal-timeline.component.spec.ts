import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { JournalFormState } from '../../state/journal-form.state';
import { JournalTagsState } from '../../state/journal-tags.state';
import { JournalTimelineComponent } from './journal-timeline.component';

describe('JournalTimelineComponent', () => {
    function setup() {
        const selectedDate = signal('2026-09-18');
        const selectDate = vi.fn((date: string) => selectedDate.set(date));
        const activeTagFilter = signal<string | null>(null);
        const setFilter = vi.fn((tag: string) => activeTagFilter.set(tag));
        const clearFilter = vi.fn(() => activeTagFilter.set(null));
        TestBed.configureTestingModule({
            imports: [JournalTimelineComponent],
            providers: [
                { provide: JournalFormState, useValue: { selectedDate, selectDate } },
                { provide: JournalTagsState, useValue: {
                    activeTagFilter, setFilter, clearFilter,
                    allTags: () => ['Patient'],
                    filteredGroupedTimeline: () => [{ monthYear: 'September 2026', entries: [
                        { date: '2026-09-18', displayDate: 'Sep 18', pnl: 200, preview: 'Kept my plan', mood: 4 },
                        { date: '2026-09-19', displayDate: 'Sep 19', isToday: true },
                    ] }],
                } },
            ],
        });
        const fixture = TestBed.createComponent(JournalTimelineComponent);
        fixture.detectChanges();
        return { fixture, selectDate, setFilter, clearFilter };
    }

    it('opens and closes history without changing the selected day or resetting its draft', () => {
        const { fixture, selectDate } = setup();
        const trigger = fixture.nativeElement.querySelector('.journal-timeline__trigger') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        trigger.click();
        fixture.detectChanges();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(selectDate).not.toHaveBeenCalled();
    });

    it('delegates date selection and identifies the current day accessibly', () => {
        const { fixture, selectDate } = setup();
        const days = fixture.nativeElement.querySelectorAll('.journal-day') as NodeListOf<HTMLButtonElement>;
        expect(days[0].getAttribute('aria-current')).toBe('date');
        days[1].click();
        fixture.detectChanges();
        expect(selectDate).toHaveBeenCalledWith('2026-09-19');
        expect(days[0].hasAttribute('aria-current')).toBe(false);
        expect(days[1].getAttribute('aria-current')).toBe('date');
    });

    it('closes history and restores focus to its trigger after a phone date selection', async () => {
        const { fixture } = setup();
        const trigger = fixture.nativeElement.querySelector('.journal-timeline__trigger') as HTMLButtonElement;
        vi.spyOn(trigger, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const focus = vi.spyOn(trigger, 'focus');
        fixture.componentInstance.open.set(true);
        fixture.componentInstance.selectDate('2026-09-19');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(fixture.componentInstance.open()).toBe(false);
        expect(focus).toHaveBeenCalled();
    });

    it('reuses the existing tag filter and clear actions', () => {
        const { fixture, setFilter, clearFilter } = setup();
        fixture.nativeElement.querySelector('.journal-timeline__header button').click();
        fixture.detectChanges();
        fixture.nativeElement.querySelector('.journal-timeline__tags button').click();
        fixture.detectChanges();
        expect(setFilter).toHaveBeenCalledWith('Patient');
        expect(fixture.nativeElement.querySelector('.journal-timeline__tags button').getAttribute('aria-pressed')).toBe('true');
        fixture.nativeElement.querySelector('.journal-timeline__filter').click();
        fixture.detectChanges();
        expect(clearFilter).toHaveBeenCalledOnce();
        expect(fixture.nativeElement.querySelector('.journal-timeline__filter')).toBeNull();
    });
});
