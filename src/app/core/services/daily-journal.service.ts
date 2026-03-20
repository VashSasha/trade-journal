import { Injectable, signal } from '@angular/core';
import { DailyNote } from '../models/daily-journal.model';

const STORAGE_KEY = 'daily_journal_notes';

@Injectable({
    providedIn: 'root'
})
export class DailyJournalService {
    private notesSignal = signal<DailyNote[]>(this.loadNotes());
    notes = this.notesSignal.asReadonly();

    constructor() { }

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

    private loadNotes(): DailyNote[] {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    private saveToStorage(notes: DailyNote[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    }
}