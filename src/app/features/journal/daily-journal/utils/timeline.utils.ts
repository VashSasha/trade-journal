import { DailyNote } from '../../../../core/models/daily-journal.model';

export interface TimelineEntry {
    date: string;
    displayDate: string;
    preview: string;
    hasContent: boolean;
    isToday: boolean;
    mood?: number;
    pnl?: number;
}

export interface MonthGroup {
    monthYear: string;
    entries: TimelineEntry[];
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
}

export function buildTimelineEntry(
    date: Date,
    dateStr: string,
    todayStr: string,
    note: DailyNote | undefined,
    dayTradesPnl: number,
    hasTradesForDay: boolean
): TimelineEntry {
    const rawText = note?.preMarketPlan || note?.content || '';
    const plainText = stripHtml(rawText);
    const preview = plainText
        ? plainText.substring(0, 70) + (plainText.length > 70 ? '...' : '')
        : '';

    return {
        date: dateStr,
        displayDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        preview,
        hasContent: !!(note || hasTradesForDay),
        isToday: dateStr === todayStr,
        mood: note?.mood,
        pnl: hasTradesForDay ? dayTradesPnl : undefined
    };
}

export function groupEntriesByMonth(entries: TimelineEntry[]): MonthGroup[] {
    const groups = new Map<string, TimelineEntry[]>();

    entries.forEach(entry => {
        const date = new Date(entry.date + 'T12:00:00');
        const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (!groups.has(monthYear)) groups.set(monthYear, []);
        groups.get(monthYear)!.push(entry);
    });

    const result: MonthGroup[] = [];
    groups.forEach((ents, monthYear) => result.push({ monthYear, entries: ents }));
    return result;
}
