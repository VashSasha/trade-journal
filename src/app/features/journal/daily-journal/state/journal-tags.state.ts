import { Injectable, computed, inject, signal } from '@angular/core';
import { DailyJournalService } from '../../../../core/services/daily-journal.service';
import { JournalFormState } from './journal-form.state';
import { MonthGroup } from '../utils/timeline.utils';

const TAG_COLORS: Array<{ bg: string; text: string; border: string }> = [
    { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' }, // violet
    { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' }, // blue
    { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' }, // emerald
    { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' }, // amber
    { bg: '#ffe4e6', text: '#9f1239', border: '#fda4af' }, // rose
    { bg: '#cffafe', text: '#155e75', border: '#67e8f9' }, // cyan
    { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' }, // orange
    { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' }, // pink
];

@Injectable()
export class JournalTagsState {
    private journalService = inject(DailyJournalService);
    private form = inject(JournalFormState);

    tagInput = signal('');
    showTagDropdown = signal(false);
    sidebarTagsOpen = signal(true);
    activeTagFilter = signal<string | null>(null);

    /** All unique tags across all saved notes, sorted alphabetically */
    allTags = computed(() => {
        const tagSet = new Set<string>();
        this.journalService.notes().forEach(note => note.tags?.forEach(t => tagSet.add(t)));
        this.form.tags().forEach(t => tagSet.add(t));
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    });

    /** Tags shown in autocomplete dropdown (not already on the current note) */
    dropdownOptions = computed(() => {
        const input = this.tagInput().toLowerCase().trim();
        const existing = new Set(this.form.tags());
        const candidates = this.allTags().filter(t => !existing.has(t));
        if (!input) return candidates;
        return candidates.filter(t => t.toLowerCase().includes(input));
    });

    /** Whether the exact input text already exists as a tag option */
    inputIsNewTag = computed(() => {
        const input = this.tagInput().trim();
        if (!input) return false;
        return !this.allTags().some(t => t.toLowerCase() === input.toLowerCase());
    });

    /** Grouped timeline filtered by active tag filter */
    filteredGroupedTimeline = computed((): MonthGroup[] => {
        const filter = this.activeTagFilter();
        const groups = this.form.groupedTimeline();
        if (!filter) return groups;

        const filteredDates = new Set(
            this.journalService.notes()
                .filter(n => n.tags?.includes(filter))
                .map(n => n.date)
        );

        return groups
            .map(group => ({
                ...group,
                entries: group.entries.filter(e => filteredDates.has(e.date))
            }))
            .filter(group => group.entries.length > 0);
    });

    addTag(tag: string): void {
        const trimmed = tag.trim();
        if (!trimmed || this.form.tags().includes(trimmed)) return;
        this.form.tags.update(tags => [...tags, trimmed]);
        this.tagInput.set('');
        this.showTagDropdown.set(false);
        this.form.markDirty();
    }

    addFromInput(): void {
        const val = this.tagInput().trim();
        if (val) this.addTag(val);
    }

    removeTag(tag: string): void {
        this.form.tags.update(tags => tags.filter(t => t !== tag));
        this.form.markDirty();
    }

    setFilter(tag: string): void {
        this.activeTagFilter.set(this.activeTagFilter() === tag ? null : tag);
    }

    clearFilter(): void {
        this.activeTagFilter.set(null);
    }

    tagColor(tag: string): { bg: string; text: string; border: string } {
        let hash = 0;
        for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
        return TAG_COLORS[hash % TAG_COLORS.length];
    }
}