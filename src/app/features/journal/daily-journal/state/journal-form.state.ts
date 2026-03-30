import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { TradeService } from '../../../../core/services/trade.service';
import { EconomicCalendarService } from '../../../../core/services/economic-calendar.service';
import { AccountService } from '../../../../core/services/account.service';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { buildTimelineEntry, groupEntriesByMonth, MonthGroup, TimelineEntry } from '../utils/timeline.utils';

@Injectable()
export class JournalFormState {
    private journalService = inject(DailyJournalService);
    tradeService = inject(TradeService);
    private economicCalendarService = inject(EconomicCalendarService);
    private accountService = inject(AccountService);
    private accountSettings = inject(AccountSettingsService);

    selectedDate = signal(new Date().toISOString().split('T')[0]);
    lastSaved = signal<Date | null>(null);
    isDirty = signal(false);
    showAllTrades = signal(false);

    preMarketPlan = signal('');
    postMarketReview = signal('');
    mood = signal(0);
    discipline = signal(0);
    checkedRules = signal<Set<string>>(new Set());
    noteContent = signal('');
    avoidedNewsEvents = signal<Set<string>>(new Set());
    customNewsEvents = signal<Array<{ name: string; time: string; avoided: boolean }>>([]);

    tags = signal<string[]>([]);

    notesExpanded = signal(false);

    dayTrades = computed(() => {
        const date = this.selectedDate();
        const selectedIds = this.accountService.selectedIds();
        const total = this.accountService.accounts().length;
        return this.tradeService.trades()
            .filter(t => {
                if (!t.entryDate?.startsWith(date)) return false;
                if (selectedIds.length > 0 && selectedIds.length < total && t.accountId && t.accountId !== '0') {
                    return selectedIds.includes(+t.accountId);
                }
                return true;
            })
            .sort((a, b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? ''));
    });

    dayPnl = computed(() =>
        this.dayTrades().reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0)
    );

    priorBalance = computed(() => {
        const date = this.selectedDate();
        const closedBefore = this.tradeService.trades().filter(
            t => t.status === 'closed' && t.exitDate && t.exitDate < date + 'T'
        );
        const cumulativePnl = closedBefore.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);
        return this.accountSettings.startingBalance() + cumulativePnl;
    });

    displayDate = computed(() =>
        new Date(this.selectedDate() + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })
    );

    timelineEntries = computed((): TimelineEntry[] => {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const trades = this.tradeService.trades();
        const selectedIds = this.accountService.selectedIds();
        const total = this.accountService.accounts().length;
        const entries: TimelineEntry[] = [];

        for (let i = 0; i < 60; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const note = this.journalService.getNoteForDate(dateStr);
            const dayTrades = trades.filter(t => {
                if (!t.entryDate?.startsWith(dateStr)) return false;
                if (selectedIds.length > 0 && selectedIds.length < total && t.accountId && t.accountId !== '0') {
                    return selectedIds.includes(+t.accountId);
                }
                return true;
            });
            const pnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

            entries.push(buildTimelineEntry(date, dateStr, todayStr, note, pnl, dayTrades.length > 0));
        }

        return entries;
    });

    groupedTimeline = computed((): MonthGroup[] =>
        groupEntriesByMonth(this.timelineEntries())
    );

    constructor() {
        effect(() => {
            const date = this.selectedDate();
            this.showAllTrades.set(false);
            const note = this.journalService.getNoteForDate(date);
            this.preMarketPlan.set(note?.preMarketPlan ?? '');
            this.postMarketReview.set(note?.postMarketReview ?? '');
            this.mood.set(note?.mood ?? 0);
            this.discipline.set(note?.discipline ?? 0);
            this.checkedRules.set(new Set(note?.rulesFollowed ?? []));
            this.noteContent.set(note?.content ?? '');
            this.lastSaved.set(note ? new Date(note.updatedAt) : null);
            this.tags.set(note?.tags ?? []);

            if (note?.avoidedNewsEvents) {
                this.avoidedNewsEvents.set(new Set(note.avoidedNewsEvents));
            } else {
                const d = new Date(date + 'T12:00:00');
                const events = this.economicCalendarService.getEventsForMonth(d.getFullYear(), d.getMonth())
                    .filter(e => e.date === date);
                this.avoidedNewsEvents.set(new Set(events.map(e => e.abbr)));
            }
            this.customNewsEvents.set(note?.customNewsEvents ?? []);
            this.isDirty.set(false);
        });
    }

    changeDate(days: number): void {
        const d = new Date(this.selectedDate() + 'T12:00:00');
        d.setDate(d.getDate() + days);
        this.selectedDate.set(d.toISOString().split('T')[0]);
    }

    onDateChange(event: Event): void {
        this.selectedDate.set((event.target as HTMLInputElement).value);
    }

    selectDate(dateStr: string): void {
        this.selectedDate.set(dateStr);
    }

    markDirty(): void {
        this.isDirty.set(true);
    }

    setPreMarketPlan(v: string): void { this.preMarketPlan.set(v); this.isDirty.set(true); }
    setPostMarketReview(v: string): void { this.postMarketReview.set(v); this.isDirty.set(true); }
    setNoteContent(v: string): void { this.noteContent.set(v); this.isDirty.set(true); }

    setMood(value: number): void {
        this.mood.set(this.mood() === value ? 0 : value);
        this.isDirty.set(true);
    }

    setDiscipline(value: number): void {
        this.discipline.set(this.discipline() === value ? 0 : value);
        this.isDirty.set(true);
    }

    toggleRule(rule: string): void {
        const current = new Set(this.checkedRules());
        if (current.has(rule)) current.delete(rule); else current.add(rule);
        this.checkedRules.set(current);
        this.isDirty.set(true);
    }

    saveNote(): void {
        this.journalService.saveNote(this.selectedDate(), {
            content: this.noteContent(),
            preMarketPlan: this.preMarketPlan(),
            postMarketReview: this.postMarketReview(),
            mood: this.mood() || undefined,
            discipline: this.discipline() || undefined,
            rulesFollowed: Array.from(this.checkedRules()),
            avoidedNewsEvents: Array.from(this.avoidedNewsEvents()),
            customNewsEvents: this.customNewsEvents(),
            tags: this.tags(),
        });
        this.lastSaved.set(new Date());
        this.isDirty.set(false);
    }

    moodLabel(value: number): string {
        return ['', 'Terrible', 'Bad', 'Neutral', 'Good', 'Great'][value] ?? '';
    }
}
