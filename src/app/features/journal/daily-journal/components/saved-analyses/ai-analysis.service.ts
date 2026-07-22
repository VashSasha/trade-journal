import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../../../../core/services/supabase.service';

/** A persisted AI day-analysis (row of public.ai_analyses). */
export interface SavedAnalysis {
    id: string;
    date: string;      // YYYY-MM-DD
    content: string;   // markdown
    createdAt: string; // ISO timestamp
}

const COLUMNS = 'id, date, content, created_at';

function rowToAnalysis(row: any): SavedAnalysis {
    return {
        id: row.id,
        date: row.date,
        content: row.content,
        createdAt: row.created_at,
    };
}

/**
 * Cloud-only store for saved AI day-analyses. No localStorage — this data is
 * small and lives entirely in Supabase (owner-scoped by RLS; user_id defaults
 * to auth.uid() server-side). Scoped to the journal shell so day-summary (which
 * saves) and the saved-analyses widget (which lists/deletes) share one instance
 * and stay in sync via the `analyses` signal.
 */
@Injectable()
export class AiAnalysisService {
    private client = inject(SupabaseService).client;

    /** Saved analyses for the most recently loaded date, newest first. */
    readonly analyses = signal<SavedAnalysis[]>([]);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    /** The date currently reflected in `analyses`, so saves can update it live. */
    private loadedDate: string | null = null;

    /** Fetch a day's saved analyses (newest first) into the `analyses` signal. */
    async listAnalyses(date: string): Promise<void> {
        this.loadedDate = date;
        this.loading.set(true);
        this.error.set(null);

        const { data, error } = await this.client
            .from('ai_analyses')
            .select(COLUMNS)
            .eq('kind', 'journal')
            .eq('date', date)
            .order('created_at', { ascending: false });

        this.loading.set(false);
        if (error) {
            this.error.set('Could not load saved analyses.');
            return;
        }
        this.analyses.set((data ?? []).map(rowToAnalysis));
    }

    /** Persist a new analysis for `date`; prepends to `analyses` if it's loaded. */
    async saveAnalysis(date: string, content: string): Promise<SavedAnalysis> {
        const { data, error } = await this.client
            .from('ai_analyses')
            .insert({ kind: 'journal', date, content })
            .select(COLUMNS)
            .single();

        if (error) throw error;

        const saved = rowToAnalysis(data);
        if (this.loadedDate === date) {
            this.analyses.update(list => [saved, ...list]);
        }
        return saved;
    }

    /** Delete a saved analysis and drop it from the `analyses` signal. */
    async deleteAnalysis(id: string): Promise<void> {
        const { error } = await this.client
            .from('ai_analyses')
            .delete()
            .eq('id', id);

        if (error) throw error;
        this.analyses.update(list => list.filter(a => a.id !== id));
    }
}
