import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { VerdictCard } from './verdict-card.model';

export interface SavedReport {
    id: string;
    title: string;
    verdict: VerdictCard;
    createdAt: string;
}

const COLUMNS = 'id, title, content, created_at';

function rowToReport(row: any): SavedReport | null {
    try {
        return {
            id: row.id,
            title: row.title ?? '',
            verdict: JSON.parse(row.content),
            createdAt: row.created_at,
        };
    } catch {
        return null;
    }
}

@Injectable({ providedIn: 'root' })
export class ReportAnalysisService {
    private client = inject(SupabaseService).client;

    readonly reports = signal<SavedReport[]>([]);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    async listReports(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);

        const { data, error } = await this.client
            .from('ai_analyses')
            .select(COLUMNS)
            .eq('kind', 'report')
            .order('created_at', { ascending: false });

        this.loading.set(false);
        if (error) {
            this.error.set('Could not load saved reports.');
            return;
        }
        this.reports.set(
            (data ?? []).map(rowToReport).filter((r): r is SavedReport => r !== null)
        );
    }

    async saveReport(title: string, verdict: VerdictCard): Promise<SavedReport> {
        const { data, error } = await this.client
            .from('ai_analyses')
            .insert({ kind: 'report', title, content: JSON.stringify(verdict) })
            .select(COLUMNS)
            .single();

        if (error) throw error;
        const saved = rowToReport(data);
        if (!saved) throw new Error('Failed to parse saved report');
        this.reports.update(list => [saved, ...list]);
        return saved;
    }

    async deleteReport(id: string): Promise<void> {
        const { error } = await this.client
            .from('ai_analyses')
            .delete()
            .eq('id', id);

        if (error) throw error;
        this.reports.update(list => list.filter(r => r.id !== id));
    }
}
