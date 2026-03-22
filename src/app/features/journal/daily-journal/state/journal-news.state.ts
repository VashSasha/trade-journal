import { Injectable, computed, inject, signal } from '@angular/core';
import { EconomicCalendarService } from '../../../../core/services/economic-calendar.service';
import { JournalFormState } from './journal-form.state';

@Injectable()
export class JournalNewsState {
    private economicCalendarService = inject(EconomicCalendarService);
    private form = inject(JournalFormState);

    showAddEvent = signal(false);
    newEventName = signal('');
    newEventTime = signal('');

    dayEvents = computed(() => {
        const date = new Date(this.form.selectedDate() + 'T12:00:00');
        return this.economicCalendarService.getEventsForMonth(date.getFullYear(), date.getMonth())
            .filter(e => e.date === this.form.selectedDate());
    });

    toggleNewsEvent(abbr: string): void {
        const current = new Set(this.form.avoidedNewsEvents());
        if (current.has(abbr)) current.delete(abbr); else current.add(abbr);
        this.form.avoidedNewsEvents.set(current);
        this.form.markDirty();
    }

    addCustomEvent(): void {
        const name = this.newEventName().trim();
        if (!name) return;
        this.form.customNewsEvents.update(list => [
            ...list,
            { name, time: this.newEventTime(), avoided: true }
        ]);
        this.newEventName.set('');
        this.newEventTime.set('');
        this.showAddEvent.set(false);
        this.form.markDirty();
    }

    toggleCustomEvent(index: number): void {
        this.form.customNewsEvents.update(list =>
            list.map((e, i) => i === index ? { ...e, avoided: !e.avoided } : e)
        );
        this.form.markDirty();
    }

    removeCustomEvent(index: number): void {
        this.form.customNewsEvents.update(list => list.filter((_, i) => i !== index));
        this.form.markDirty();
    }
}
