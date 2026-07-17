import { Injectable, inject, signal } from '@angular/core';
import { DailyNote, DEFAULT_TRADING_RULES, JournalTemplate } from '../models/daily-journal.model';
import { UserDataRepo } from './user-data/user-data.repo';
import { CACHE_KEYS, readCache, writeCache } from './user-data/user-data.cache';

@Injectable({
    providedIn: 'root'
})
export class DailyJournalService {
    private repo = inject(UserDataRepo);

    // Signals start from the offline cache; UserDataService replaces them with
    // the authoritative Supabase rows once the post-login fetch completes.
    private notesSignal = signal<DailyNote[]>(readCache<DailyNote[]>(CACHE_KEYS.notes) ?? []);
    notes = this.notesSignal.asReadonly();

    private customRulesSignal = signal<string[]>(
        readCache<string[]>(CACHE_KEYS.rules) ?? [...DEFAULT_TRADING_RULES]
    );
    customRules = this.customRulesSignal.asReadonly();

    private templatesSignal = signal<JournalTemplate[]>(
        readCache<JournalTemplate[]>(CACHE_KEYS.templates) ?? []
    );
    templates = this.templatesSignal.asReadonly();

    constructor() { }

    // ── Notes ────────────────────────────────────────────────

    getNoteForDate(date: string): DailyNote | undefined {
        return this.notesSignal().find(n => n.date === date);
    }

    saveNote(date: string, data: Partial<Omit<DailyNote, 'id' | 'date' | 'createdAt' | 'updatedAt'>>): void {
        const currentNotes = this.notesSignal();
        const existingIndex = currentNotes.findIndex(n => n.date === date);
        const now = new Date().toISOString();

        let updatedNotes: DailyNote[];
        let savedNote: DailyNote;

        if (existingIndex >= 0) {
            savedNote = {
                ...currentNotes[existingIndex],
                ...data,
                updatedAt: now
            };
            updatedNotes = [...currentNotes];
            updatedNotes[existingIndex] = savedNote;
        } else {
            savedNote = {
                id: Date.now().toString(),
                date,
                content: '',
                ...data,
                createdAt: now,
                updatedAt: now
            };
            updatedNotes = [...currentNotes, savedNote];
        }

        this.notesSignal.set(updatedNotes);
        this.saveToStorage(updatedNotes);
        this.repo.queueNoteUpsert(savedNote);
    }

    // ── Custom Rules ─────────────────────────────────────────

    addRule(text: string): void {
        this.setRules([...this.customRulesSignal(), text]);
    }

    updateRule(index: number, text: string): void {
        this.setRules(this.customRulesSignal().map((r, i) => i === index ? text : r));
    }

    deleteRule(index: number): void {
        this.setRules(this.customRulesSignal().filter((_, i) => i !== index));
    }

    swapRules(indexA: number, indexB: number): void {
        const rules = [...this.customRulesSignal()];
        [rules[indexA], rules[indexB]] = [rules[indexB], rules[indexA]];
        this.setRules(rules);
    }

    private setRules(rules: string[]): void {
        this.customRulesSignal.set(rules);
        writeCache(CACHE_KEYS.rules, rules);
        // Rules live on the user's single user_settings row.
        this.repo.queueSettingsUpsert({ customRules: rules });
    }

    // ── Templates ────────────────────────────────────────────

    saveTemplate(name: string, type: 'plan' | 'notes', content: string): JournalTemplate {
        const now = new Date().toISOString();
        const template: JournalTemplate = {
            id: Date.now().toString(),
            name,
            type,
            content,
            createdAt: now,
            updatedAt: now,
        };
        const updated = [...this.templatesSignal(), template];
        this.templatesSignal.set(updated);
        writeCache(CACHE_KEYS.templates, updated);
        this.repo.queueTemplateUpsert(template);
        return template;
    }

    updateTemplate(id: string, name: string, content: string): void {
        const now = new Date().toISOString();
        let saved: JournalTemplate | undefined;
        const updated = this.templatesSignal().map(t => {
            if (t.id !== id) return t;
            saved = { ...t, name, content, updatedAt: now };
            return saved;
        });
        this.templatesSignal.set(updated);
        writeCache(CACHE_KEYS.templates, updated);
        if (saved) this.repo.queueTemplateUpsert(saved);
    }

    deleteTemplate(id: string): void {
        const updated = this.templatesSignal().filter(t => t.id !== id);
        this.templatesSignal.set(updated);
        writeCache(CACHE_KEYS.templates, updated);
        this.repo.queueTemplateDelete(id);
    }

    // ── Hydration (UserDataService: cloud fetch / sign-out reset) ────────

    hydrateNotes(notes: DailyNote[]): void {
        this.notesSignal.set(notes);
        this.saveToStorage(notes);
    }

    /** null → the default rule set (new user, or sign-out reset). */
    hydrateRules(rules: string[] | null): void {
        const value = rules ?? [...DEFAULT_TRADING_RULES];
        this.customRulesSignal.set(value);
        writeCache(CACHE_KEYS.rules, value);
    }

    hydrateTemplates(templates: JournalTemplate[]): void {
        this.templatesSignal.set(templates);
        writeCache(CACHE_KEYS.templates, templates);
    }

    // ── Private ──────────────────────────────────────────────

    private saveToStorage(notes: DailyNote[]): void {
        writeCache(CACHE_KEYS.notes, notes);
    }
}
