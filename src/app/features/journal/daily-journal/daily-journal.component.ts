import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DailyJournalService } from '../../../core/services/daily-journal.service';
import { QuillModule } from 'ngx-quill'


interface TimelineEntry {
    date: string;
    displayDate: string;
    preview: string;
    hasContent: boolean;
    isToday: boolean;
}

interface MonthGroup {
    monthYear: string;
    entries: TimelineEntry[];
}

@Component({
    selector: 'app-daily-journal',
    standalone: true,
    imports: [CommonModule, FormsModule, QuillModule],
    templateUrl: './daily-journal.component.html'
})
export class DailyJournalComponent {
    private journalService = inject(DailyJournalService);

    selectedDate = signal(new Date().toISOString().split('T')[0]);
    noteContent = signal('');

    // Status feedback
    lastSaved = signal<Date | null>(null);

    // Quill editor configuration
    quillModules = {
        toolbar: [
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote', 'code-block'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['link'],
            ['clean']
        ]
    };

    constructor() {
        // Load note when date changes
        effect(() => {
            const date = this.selectedDate();
            const note = this.journalService.getNoteForDate(date);
            this.noteContent.set(note ? note.content : '');
            this.lastSaved.set(note ? new Date(note.updatedAt) : null);
        }, { allowSignalWrites: true });
    }

    // Timeline entries for the last 60 days
    timelineEntries = computed(() => {
        const entries: TimelineEntry[] = [];
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Generate last 60 days
        for (let i = 0; i < 60; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const note = this.journalService.getNoteForDate(dateStr);
            // Strip HTML tags for preview
            const plainText = note?.content
                ? note.content.replace(/<[^>]*>/g, '').trim()
                : '';
            const preview = plainText
                ? plainText.substring(0, 80) + (plainText.length > 80 ? '...' : '')
                : '';

            entries.push({
                date: dateStr,
                displayDate: date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                }),
                preview,
                hasContent: !!note,
                isToday: dateStr === todayStr
            });
        }

        return entries;
    });

    // Group timeline entries by month
    groupedTimeline = computed(() => {
        const entries = this.timelineEntries();
        const groups = new Map<string, TimelineEntry[]>();

        entries.forEach(entry => {
            const date = new Date(entry.date);
            const monthYear = date.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
            });

            if (!groups.has(monthYear)) {
                groups.set(monthYear, []);
            }
            groups.get(monthYear)!.push(entry);
        });

        const result: MonthGroup[] = [];
        groups.forEach((entries, monthYear) => {
            result.push({ monthYear, entries });
        });

        return result;
    });

    onDateChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.selectedDate.set(input.value);
    }

    changeDate(days: number): void {
        const current = new Date(this.selectedDate());
        current.setDate(current.getDate() + days);
        this.selectedDate.set(current.toISOString().split('T')[0]);
    }

    selectDate(dateStr: string): void {
        this.selectedDate.set(dateStr);
    }

    saveNote(): void {
        this.journalService.saveNote(this.selectedDate(), this.noteContent());
        this.lastSaved.set(new Date());
    }

    // Helper for display
    displayDate = computed(() => {
        return new Date(this.selectedDate()).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    });
}
