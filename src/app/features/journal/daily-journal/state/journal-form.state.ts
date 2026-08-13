import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { TradeService } from '../../../../core/services/trade.service';
import { EconomicCalendarService } from '../../../../core/services/economic-calendar.service';
import { AccountService } from '../../../../core/services/account.service';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { FilterService } from '../../../../core/services/filter.service';
import { DemoModeService } from '../../../../core/services/demo-mode.service';
import { buildTimelineEntry, groupEntriesByMonth, MonthGroup, TimelineEntry } from '../utils/timeline.utils';
import { tradeSessionDateStr } from '../../../../core/utils/market-holidays';
import { NewsEventTag } from '../../../../core/models/daily-journal.model';

function localDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

@Injectable()
export class JournalFormState {
    private journalService = inject(DailyJournalService);
    private demo = inject(DemoModeService);
    tradeService = inject(TradeService);
    private economicCalendarService = inject(EconomicCalendarService);
    private accountService = inject(AccountService);
    private accountSettings = inject(AccountSettingsService);
    private filterService = inject(FilterService);

    selectedDate = signal(localDateStr(new Date()));
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
    newsEventTags = signal<NewsEventTag[]>([]);

    tags = signal<string[]>([]);

    notesExpanded = signal(false);

    // Trades scoped to the header account selection — same FilterService
    // source of truth as every other page (the calendar-heatmap pattern:
    // account/symbol filters apply, date navigation is our own).
    private filteredTrades = computed(() =>
        this.filterService.filterTradesIgnoreDateRange(this.tradeService.trades())
    );

    dayTrades = computed(() => {
        const date = this.selectedDate();
        return this.filteredTrades()
            .filter(t => {
                const dateKey = (t.status === 'closed' && t.exitDate) ? t.exitDate : t.entryDate;
                return !!dateKey && tradeSessionDateStr(dateKey) === date;
            })
            .sort((a, b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? ''));
    });

    dayPnl = computed(() =>
        this.dayTrades().reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0)
    );

    /**
     * Combined balance of the selected accounts. Per account: live API
     * balance → stored last_balance (both merged in accountBalances()) →
     * the account-size setting as the final fallback, so a selection of
     * historical accounts never collapses the chart baseline to ~$0.
     */
    private selectedBalance = computed(() => {
        const selected = this.accountService.selectedIds();
        const fallback = this.accountSettings.startingBalance();
        if (selected.length === 0) return fallback;
        const balances = this.accountService.accountBalances();
        return selected.reduce((sum, id) => sum + (balances.get(id) ?? fallback), 0);
    });

    priorBalance = computed(() =>
        this.selectedBalance() - this.dayPnl()
    );

    displayDate = computed(() =>
        new Date(this.selectedDate() + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })
    );

    timelineEntries = computed((): TimelineEntry[] => {
        // Anchor on the current trading SESSION date, not the raw wall-clock
        // date. CME futures roll to the next session at 5 PM local, so a trade
        // taken during tonight's Asia session is session-dated tomorrow. A loop
        // anchored on today's calendar date would only ever walk backward and
        // could never produce that "tomorrow" entry — the session's trades
        // would have nowhere to attach in the timeline. Anchoring on the
        // session date shifts the whole window forward by (at most) one day
        // exactly when the current session already belongs to tomorrow, so
        // "Today" in the timeline always matches the session trades are
        // grouped under everywhere else in the app.
        const now = new Date();
        const anchorStr = tradeSessionDateStr(now.toISOString());
        const anchor = new Date(anchorStr + 'T12:00:00');
        const todayStr = anchorStr;
        const trades = this.filteredTrades();
        const entries: TimelineEntry[] = [];

        for (let i = 0; i < 60; i++) {
            const date = new Date(anchor);
            date.setDate(date.getDate() - i);
            const dateStr = localDateStr(date);

            const note = this.journalService.getNoteForDate(dateStr);
            const dayTrades = trades.filter(t => {
                const dateKey = (t.status === 'closed' && t.exitDate) ? t.exitDate : t.entryDate;
                return !!dateKey && tradeSessionDateStr(dateKey) === dateStr;
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
            this.newsEventTags.set(note?.newsEventTags ?? []);
            this.isDirty.set(false);
        });
    }

    changeDate(days: number): void {
        const d = new Date(this.selectedDate() + 'T12:00:00');
        d.setDate(d.getDate() + days);
        this.selectedDate.set(localDateStr(d));
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
        if (!this.demo.requireAccount('save')) return;
        this.journalService.saveNote(this.selectedDate(), {
            content: this.noteContent(),
            preMarketPlan: this.preMarketPlan(),
            postMarketReview: this.postMarketReview(),
            mood: this.mood() || undefined,
            discipline: this.discipline() || undefined,
            rulesFollowed: Array.from(this.checkedRules()),
            avoidedNewsEvents: Array.from(this.avoidedNewsEvents()),
            customNewsEvents: this.customNewsEvents(),
            newsEventTags: this.newsEventTags(),
            tags: this.tags(),
        });
        this.lastSaved.set(new Date());
        this.isDirty.set(false);
    }

    moodLabel(value: number): string {
        return ['', 'Terrible', 'Bad', 'Neutral', 'Good', 'Great'][value] ?? '';
    }
}
