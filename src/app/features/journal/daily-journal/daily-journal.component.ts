import { Component, computed, inject, signal, effect } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DailyJournalService } from '../../../core/services/daily-journal.service';
import { TradeService } from '../../../core/services/trade.service';
import { EconomicCalendarService } from '../../../core/services/economic-calendar.service';
import { JournalTemplate } from '../../../core/models/daily-journal.model';
import { TradeTableComponent } from '../../../shared/components/trade-table/trade-table.component';
import { QuillModule } from 'ngx-quill';


interface TimelineEntry {
    date: string;
    displayDate: string;
    preview: string;
    hasContent: boolean;
    isToday: boolean;
    mood?: number;
    pnl?: number;
}

interface MonthGroup {
    monthYear: string;
    entries: TimelineEntry[];
}

@Component({
    selector: 'app-daily-journal',
    standalone: true,
    imports: [DatePipe, CurrencyPipe, FormsModule, QuillModule, TradeTableComponent],
    templateUrl: './daily-journal.component.html',
    styleUrl: './daily-journal.component.scss'
})
export class DailyJournalComponent {
    private journalService = inject(DailyJournalService);
    tradeService = inject(TradeService);
    private economicCalendarService = inject(EconomicCalendarService);

    readonly TRADES_PAGE_SIZE = 5;

    selectedDate = signal(new Date().toISOString().split('T')[0]);
    lastSaved = signal<Date | null>(null);
    showAllTrades = signal(false);

    // Structured fields
    preMarketPlan = signal('');
    postMarketReview = signal('');
    mood = signal(0);
    discipline = signal(0);
    checkedRules = signal<Set<string>>(new Set());
    noteContent = signal('');
    avoidedNewsEvents = signal<Set<string>>(new Set());
    customNewsEvents = signal<Array<{ name: string; time: string; avoided: boolean }>>([]);
    showAddEvent = signal(false);
    newEventName = signal('');
    newEventTime = signal('');

    // ── Rules management ─────────────────────────────────────
    customRules = this.journalService.customRules;
    showManageRules = signal(false);
    editingRuleIndex = signal<number | null>(null);
    editingRuleText = signal('');
    showAddRule = signal(false);
    newRuleText = signal('');

    // ── Templates panel ──────────────────────────────────────
    templates = this.journalService.templates;
    openDropdown = signal<'pre-market' | 'post-market' | 'notes' | null>(null);
    templatePanelOpen = signal(false);
    templatePanelContext = signal<'pre-market' | 'post-market' | 'notes' | null>(null);
    selectedTemplate = signal<JournalTemplate | null>(null);
    isEditingTemplate = signal(false);
    isCreatingTemplate = signal(false);
    editTemplateName = signal('');
    editTemplateContent = signal('');

    // Pre-market and post-market share 'plan' templates; notes have their own
    panelTemplates = computed(() => {
        const ctx = this.templatePanelContext();
        if (!ctx) return this.templates();
        const type = ctx === 'notes' ? 'notes' : 'plan';
        return this.templates().filter(t => t.type === type);
    });

    // ── Notes expand ─────────────────────────────────────────
    notesExpanded = signal(false);

    quillModules = {
        toolbar: [
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote', 'code-block'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['link', 'image'],
            ['clean']
        ]
    };

    // Compact toolbar shared by plan cards and template editor
    quillCompactModules = {
        toolbar: [
            ['bold', 'italic', 'underline'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['link'],
            ['clean']
        ]
    };

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

            if (note?.avoidedNewsEvents) {
                this.avoidedNewsEvents.set(new Set(note.avoidedNewsEvents));
            } else {
                const d = new Date(date + 'T12:00:00');
                const events = this.economicCalendarService.getEventsForMonth(d.getFullYear(), d.getMonth())
                    .filter(e => e.date === date);
                this.avoidedNewsEvents.set(new Set(events.map(e => e.abbr)));
            }
            this.customNewsEvents.set(note?.customNewsEvents ?? []);
            this.showAddEvent.set(false);
            this.newEventName.set('');
            this.newEventTime.set('');
        });
    }

    // News events for the selected date
    dayEvents = computed(() => {
        const date = new Date(this.selectedDate() + 'T12:00:00');
        return this.economicCalendarService.getEventsForMonth(date.getFullYear(), date.getMonth())
            .filter(e => e.date === this.selectedDate());
    });

    dayTrades = computed(() => {
        const date = this.selectedDate();
        return this.tradeService.trades()
            .filter(t => t.entryDate?.startsWith(date))
            .sort((a, b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? ''));
    });

    dayPnl = computed(() =>
        this.dayTrades().reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0)
    );

    timelineEntries = computed(() => {
        const entries: TimelineEntry[] = [];
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const trades = this.tradeService.trades();

        for (let i = 0; i < 60; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const note = this.journalService.getNoteForDate(dateStr);
            const dayTrades = trades.filter(t => t.entryDate?.startsWith(dateStr));
            const pnl = dayTrades.reduce((sum, t) => sum + (t.netPnl ?? t.pnl ?? 0), 0);

            const rawText = note?.preMarketPlan || note?.content || '';
            const plainText = rawText.replace(/<[^>]*>/g, '').trim();
            const preview = plainText
                ? plainText.substring(0, 70) + (plainText.length > 70 ? '...' : '')
                : '';

            entries.push({
                date: dateStr,
                displayDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                preview,
                hasContent: !!(note || dayTrades.length),
                isToday: dateStr === todayStr,
                mood: note?.mood,
                pnl: dayTrades.length ? pnl : undefined
            });
        }

        return entries;
    });

    groupedTimeline = computed(() => {
        const entries = this.timelineEntries();
        const groups = new Map<string, TimelineEntry[]>();

        entries.forEach(entry => {
            const date = new Date(entry.date + 'T12:00:00');
            const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (!groups.has(monthYear)) groups.set(monthYear, []);
            groups.get(monthYear)!.push(entry);
        });

        const result: MonthGroup[] = [];
        groups.forEach((entries, monthYear) => result.push({ monthYear, entries }));
        return result;
    });

    displayDate = computed(() =>
        new Date(this.selectedDate() + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })
    );

    onDateChange(event: Event): void {
        this.selectedDate.set((event.target as HTMLInputElement).value);
    }

    changeDate(days: number): void {
        const d = new Date(this.selectedDate() + 'T12:00:00');
        d.setDate(d.getDate() + days);
        this.selectedDate.set(d.toISOString().split('T')[0]);
    }

    selectDate(dateStr: string): void {
        this.selectedDate.set(dateStr);
    }

    setMood(value: number): void {
        this.mood.set(this.mood() === value ? 0 : value);
    }

    setDiscipline(value: number): void {
        this.discipline.set(this.discipline() === value ? 0 : value);
    }

    toggleRule(rule: string): void {
        const current = new Set(this.checkedRules());
        if (current.has(rule)) current.delete(rule); else current.add(rule);
        this.checkedRules.set(current);
    }

    toggleNewsEvent(abbr: string): void {
        const current = new Set(this.avoidedNewsEvents());
        if (current.has(abbr)) current.delete(abbr); else current.add(abbr);
        this.avoidedNewsEvents.set(current);
    }

    addCustomEvent(): void {
        const name = this.newEventName().trim();
        if (!name) return;
        this.customNewsEvents.update(list => [
            ...list,
            { name, time: this.newEventTime(), avoided: true }
        ]);
        this.newEventName.set('');
        this.newEventTime.set('');
        this.showAddEvent.set(false);
    }

    toggleCustomEvent(index: number): void {
        this.customNewsEvents.update(list =>
            list.map((e, i) => i === index ? { ...e, avoided: !e.avoided } : e)
        );
    }

    removeCustomEvent(index: number): void {
        this.customNewsEvents.update(list => list.filter((_, i) => i !== index));
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
        });
        this.lastSaved.set(new Date());
    }

    moodLabel(value: number): string {
        return ['', 'Terrible', 'Bad', 'Neutral', 'Good', 'Great'][value] ?? '';
    }

    // ── Rules management ─────────────────────────────────────

    startEditRule(index: number): void {
        this.editingRuleIndex.set(index);
        this.editingRuleText.set(this.customRules()[index]);
    }

    saveEditRule(): void {
        const index = this.editingRuleIndex();
        const text = this.editingRuleText().trim();
        if (index !== null && text) {
            this.journalService.updateRule(index, text);
        }
        this.editingRuleIndex.set(null);
        this.editingRuleText.set('');
    }

    cancelEditRule(): void {
        this.editingRuleIndex.set(null);
        this.editingRuleText.set('');
    }

    deleteRule(index: number): void {
        const rule = this.customRules()[index];
        const checked = new Set(this.checkedRules());
        checked.delete(rule);
        this.checkedRules.set(checked);
        this.journalService.deleteRule(index);
    }

    addRule(): void {
        const text = this.newRuleText().trim();
        if (!text) return;
        this.journalService.addRule(text);
        this.newRuleText.set('');
        this.showAddRule.set(false);
    }

    // ── Template panel ────────────────────────────────────────

    openTemplatePanel(context: 'pre-market' | 'post-market' | 'notes'): void {
        this.templatePanelContext.set(context);
        this.templatePanelOpen.set(true);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
        // Auto-select first template if any
        const first = this.panelTemplates()[0] ?? null;
        this.selectedTemplate.set(first);
    }

    closeTemplatePanel(): void {
        this.templatePanelOpen.set(false);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
        this.selectedTemplate.set(null);
    }

    selectTemplate(template: JournalTemplate): void {
        this.selectedTemplate.set(template);
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
    }

    toggleDropdown(context: 'pre-market' | 'post-market' | 'notes'): void {
        this.openDropdown.set(this.openDropdown() === context ? null : context);
    }

    // Called from quick dropdown — loads directly without opening panel
    loadTemplate(template: JournalTemplate, context: 'pre-market' | 'post-market' | 'notes'): void {
        if (context === 'pre-market') this.preMarketPlan.set(template.content);
        else if (context === 'post-market') this.postMarketReview.set(template.content);
        else this.noteContent.set(template.content);
        this.openDropdown.set(null);
    }

    useSelectedTemplate(): void {
        const tpl = this.selectedTemplate();
        const ctx = this.templatePanelContext();
        if (!tpl || !ctx) return;

        if (ctx === 'pre-market') this.preMarketPlan.set(tpl.content);
        else if (ctx === 'post-market') this.postMarketReview.set(tpl.content);
        else this.noteContent.set(tpl.content);

        this.closeTemplatePanel();
    }

    startEditSelectedTemplate(): void {
        const tpl = this.selectedTemplate();
        if (!tpl) return;
        this.editTemplateName.set(tpl.name);
        this.editTemplateContent.set(tpl.content);
        this.isEditingTemplate.set(true);
        this.isCreatingTemplate.set(false);
    }

    saveTemplateEdit(): void {
        const tpl = this.selectedTemplate();
        const name = this.editTemplateName().trim();
        const content = this.editTemplateContent();
        if (!tpl || !name) return;
        this.journalService.updateTemplate(tpl.id, name, content);
        // Refresh selected template reference
        const updated = this.templates().find(t => t.id === tpl.id);
        this.selectedTemplate.set(updated ?? null);
        this.isEditingTemplate.set(false);
    }

    cancelTemplateEdit(): void {
        this.isEditingTemplate.set(false);
        this.isCreatingTemplate.set(false);
    }

    startCreateTemplate(): void {
        const ctx = this.templatePanelContext();
        // Pre-fill content from the current section
        let content = '';
        if (ctx === 'pre-market') content = this.preMarketPlan();
        else if (ctx === 'post-market') content = this.postMarketReview();
        else content = this.noteContent();

        this.editTemplateName.set('');
        this.editTemplateContent.set(content);
        this.isCreatingTemplate.set(true);
        this.isEditingTemplate.set(false);
        this.selectedTemplate.set(null);
    }

    confirmCreateTemplate(): void {
        const name = this.editTemplateName().trim();
        const content = this.editTemplateContent();
        const ctx = this.templatePanelContext();
        if (!name || !ctx) return;
        const type: 'plan' | 'notes' = ctx === 'notes' ? 'notes' : 'plan';
        const created = this.journalService.saveTemplate(name, type, content);
        this.selectedTemplate.set(created);
        this.isCreatingTemplate.set(false);
    }

    deleteSelectedTemplate(): void {
        const tpl = this.selectedTemplate();
        if (!tpl) return;
        this.journalService.deleteTemplate(tpl.id);
        const remaining = this.panelTemplates()[0] ?? null;
        this.selectedTemplate.set(remaining);
        this.isEditingTemplate.set(false);
    }

    recentTemplates(context: 'pre-market' | 'post-market' | 'notes'): JournalTemplate[] {
        const type = context === 'notes' ? 'notes' : 'plan';
        return this.templates()
            .filter(t => t.type === type)
            .slice(-4)   // last 4 created
            .reverse();  // newest first
    }

    templateTypeLabel(context: string): string {
        if (context === 'pre-market') return 'Pre-Market Plan';
        if (context === 'post-market') return 'Post-Market Review';
        return 'Notes';
    }
}