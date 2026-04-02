import { Injectable, computed, inject, signal } from '@angular/core';
import { EconomicCalendarService } from '../../../../core/services/economic-calendar.service';
import { JournalFormState } from './journal-form.state';
import { NewsEventTag, NewsTier } from '../../../../core/models/daily-journal.model';

@Injectable()
export class JournalNewsState {
    private economicCalendarService = inject(EconomicCalendarService);
    private form = inject(JournalFormState);

    newsInput = signal('');
    showNewsDropdown = signal(false);

    /** All economic events scheduled for the selected day */
    dayEvents = computed(() => {
        const date = new Date(this.form.selectedDate() + 'T12:00:00');
        return this.economicCalendarService.getEventsForMonth(date.getFullYear(), date.getMonth())
            .filter(e => e.date === this.form.selectedDate());
    });

    /** Calendar events not yet added, filtered by current input */
    dropdownOptions = computed(() => {
        const input = this.newsInput().toLowerCase().trim();
        const added = new Set(this.form.newsEventTags().map(t => t.abbr));
        const events = this.dayEvents().filter(e => !added.has(e.abbr));
        if (!input) return events;
        return events.filter(e =>
            e.abbr.toLowerCase().includes(input) || e.event.toLowerCase().includes(input)
        );
    });

    /** True when the input text doesn't match any existing calendar event or added tag */
    inputIsNew = computed(() => {
        const input = this.newsInput().trim();
        if (!input) return false;
        const alreadyAdded = this.form.newsEventTags().some(
            t => t.name.toLowerCase() === input.toLowerCase() || t.abbr.toLowerCase() === input.toLowerCase()
        );
        const inCalendar = this.dayEvents().some(
            e => e.abbr.toLowerCase() === input.toLowerCase() || e.event.toLowerCase() === input.toLowerCase()
        );
        return !alreadyAdded && !inCalendar;
    });

    isAdded(abbr: string): boolean {
        return this.form.newsEventTags().some(t => t.abbr === abbr);
    }

    addFromCalendar(abbr: string, name: string, time?: string, link?: string): void {
        if (this.isAdded(abbr)) return;
        this.form.newsEventTags.update(tags => [
            ...tags,
            { abbr, name, tier: 'T2' as NewsTier, time, link, isCustom: false }
        ]);
        this.newsInput.set('');
        this.showNewsDropdown.set(false);
        this.form.markDirty();
    }

    addFromInput(): void {
        const name = this.newsInput().trim();
        if (!name) return;
        const abbr = name.toUpperCase().slice(0, 8);
        const uniqueAbbr = this.form.newsEventTags().some(t => t.abbr === abbr)
            ? `${abbr}_${Date.now()}`
            : abbr;
        this.form.newsEventTags.update(tags => [
            ...tags,
            { abbr: uniqueAbbr, name, tier: 'T2' as NewsTier, isCustom: true }
        ]);
        this.newsInput.set('');
        this.showNewsDropdown.set(false);
        this.form.markDirty();
    }

    removeEvent(abbr: string): void {
        this.form.newsEventTags.update(tags => tags.filter(t => t.abbr !== abbr));
        this.form.markDirty();
    }

    cycleTier(abbr: string): void {
        const order: NewsTier[] = ['T1', 'T2', 'T3'];
        this.form.newsEventTags.update(tags =>
            tags.map(t => {
                if (t.abbr !== abbr) return t;
                const next = order[(order.indexOf(t.tier) + 1) % order.length];
                return { ...t, tier: next };
            })
        );
        this.form.markDirty();
    }
}
