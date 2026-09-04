import { Injectable, inject, signal, effect } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { VerdictCard } from './verdict-card.model';
import { UserSessionService } from '../../core/services/user-session.service';

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
    private userSession = inject(UserSessionService);

    readonly reports = signal<SavedReport[]>([]);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    constructor() {
        effect(() => {
            this.userSession.userId();
            this.reports.set([]); this.loading.set(false); this.error.set(null);
        });
    }

    async listReports(): Promise<void> {
        if (!this.userSession.userId()) return;
        const scope = this.userSession.capture();
        this.loading.set(true);
        this.error.set(null);

        const { data, error } = await this.client
            .from('ai_analyses')
            .select(COLUMNS)
            .eq('kind', 'report')
            .eq('user_id', scope.userId)
            .order('created_at', { ascending: false }).abortSignal(scope.signal);
        if (!this.userSession.isCurrent(scope)) return;

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
        const scope = this.userSession.capture();
        const { data, error } = await this.client
            .from('ai_analyses')
            .insert({ user_id: scope.userId, kind: 'report', title, content: JSON.stringify(verdict) })
            .select(COLUMNS)
            .abortSignal(scope.signal).single();
        this.userSession.assertCurrent(scope);

        if (error) throw error;
        const saved = rowToReport(data);
        if (!saved) throw new Error('Failed to parse saved report');
        this.reports.update(list => [saved, ...list]);
        return saved;
    }

    async deleteReport(id: string): Promise<void> {
        const scope = this.userSession.capture();
        const { error } = await this.client
            .from('ai_analyses')
            .delete()
            .eq('id', id).eq('user_id', scope.userId).abortSignal(scope.signal);
        this.userSession.assertCurrent(scope);

        if (error) throw error;
        this.reports.update(list => list.filter(r => r.id !== id));
    }
}
