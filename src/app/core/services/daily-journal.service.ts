import { Injectable, signal } from '@angular/core';
import { DailyNote, DEFAULT_TRADING_RULES, JournalTemplate } from '../models/daily-journal.model';

const STORAGE_KEY = 'daily_journal_notes';
const RULES_STORAGE_KEY = 'journal_custom_rules';
const TEMPLATES_STORAGE_KEY = 'journal_templates';

@Injectable({
    providedIn: 'root'
})
export class DailyJournalService {
    private notesSignal = signal<DailyNote[]>(this.loadNotes());
    notes = this.notesSignal.asReadonly();

    private customRulesSignal = signal<string[]>(this.loadCustomRules());
    customRules = this.customRulesSignal.asReadonly();

    private templatesSignal = signal<JournalTemplate[]>(this.loadTemplates());
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

        if (existingIndex >= 0) {
            const updatedNote: DailyNote = {
                ...currentNotes[existingIndex],
                ...data,
                updatedAt: now
            };
            updatedNotes = [...currentNotes];
            updatedNotes[existingIndex] = updatedNote;
        } else {
            const newNote: DailyNote = {
                id: Date.now().toString(),
                date,
                content: '',
                ...data,
                createdAt: now,
                updatedAt: now
            };
            updatedNotes = [...currentNotes, newNote];
        }

        this.notesSignal.set(updatedNotes);
        this.saveToStorage(updatedNotes);
    }

    // ── Custom Rules ─────────────────────────────────────────

    addRule(text: string): void {
        const updated = [...this.customRulesSignal(), text];
        this.customRulesSignal.set(updated);
        localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(updated));
    }

    updateRule(index: number, text: string): void {
        const updated = this.customRulesSignal().map((r, i) => i === index ? text : r);
        this.customRulesSignal.set(updated);
        localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(updated));
    }

    deleteRule(index: number): void {
        const updated = this.customRulesSignal().filter((_, i) => i !== index);
        this.customRulesSignal.set(updated);
        localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(updated));
    }

    swapRules(indexA: number, indexB: number): void {
        const rules = [...this.customRulesSignal()];
        [rules[indexA], rules[indexB]] = [rules[indexB], rules[indexA]];
        this.customRulesSignal.set(rules);
        localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
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
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
        return template;
    }

    updateTemplate(id: string, name: string, content: string): void {
        const now = new Date().toISOString();
        const updated = this.templatesSignal().map(t =>
            t.id === id ? { ...t, name, content, updatedAt: now } : t
        );
        this.templatesSignal.set(updated);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    }

    deleteTemplate(id: string): void {
        const updated = this.templatesSignal().filter(t => t.id !== id);
        this.templatesSignal.set(updated);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    }

    // ── Private ──────────────────────────────────────────────

    private loadNotes(): DailyNote[] {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    private loadCustomRules(): string[] {
        const stored = localStorage.getItem(RULES_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
        // Seed from defaults on first load
        localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(DEFAULT_TRADING_RULES));
        return [...DEFAULT_TRADING_RULES];
    }

    private loadTemplates(): JournalTemplate[] {
        const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    private saveToStorage(notes: DailyNote[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    }
}
