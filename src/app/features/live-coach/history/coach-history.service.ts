import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { LiveCoachFollowUpAnswer, LiveCoachObservation, LiveCoachQuestion } from '../live-coach.models';
import { readCoachFollowUp } from '../live-coach-follow-up.utils';
import { HISTORY_COLUMNS, HISTORY_PAGE_SIZE, observationToHistory, readHistoryRow, SavedCoachObservation } from './coach-history.model';

type AnswerColumn = 'explanation' | 'session_comparison';
interface PendingSave {
    scope: UserOperation;
    row: SavedCoachObservation;
    inserted: boolean;
    answers: Partial<Record<AnswerColumn, LiveCoachFollowUpAnswer>>;
    running?: Promise<void>;
    failed: boolean;
}

/** Shared by the app-wide event listener and its review widget. No audio or AI calls. */
@Injectable({ providedIn: 'root' })
export class CoachHistoryService {
    private readonly client = inject(SupabaseService).client;
    private readonly access = inject(AccessPolicyService);
    private readonly session = inject(UserSessionService);
    readonly items = signal<readonly SavedCoachObservation[]>([]);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly date = signal('');
    readonly hasMore = signal(false);
    readonly pendingCount = signal(0);
    readonly failedCount = signal(0);
    readonly deleting = signal<string | null>(null);
    readonly removed = signal<ReadonlySet<string>>(new Set());
    readonly canReview = computed(() => !!this.session.userId() && !this.access.demo());
    private readonly queue = new Map<string, PendingSave>();
    private request = 0;
    private loaded = false;
    private cursor: Pick<SavedCoachObservation, 'id' | 'observed_at'> | null = null;

    constructor() {
        effect(() => {
            this.session.userId(); this.access.demo();
            untracked(() => {
                this.request++; this.queue.clear(); this.updateCounts();
                this.items.set([]); this.removed.set(new Set()); this.date.set('');
                this.loading.set(false); this.error.set(null); this.hasMore.set(false);
                this.deleting.set(null); this.loaded = false; this.cursor = null;
            });
        });
    }

    record(comment: LiveCoachObservation): void {
        if (!this.canReview() || !comment.historyId || this.removed().has(comment.historyId)) return;
        if (!this.queue.has(comment.historyId)) this.queue.set(comment.historyId, {
            scope: this.access.capture(), row: observationToHistory(comment), inserted: false, answers: {}, failed: false,
        });
        void this.flush(comment.historyId);
    }

    saveAnswer(comment: LiveCoachObservation, question: LiveCoachQuestion, answer: LiveCoachFollowUpAnswer): void {
        if (!this.canReview() || !comment.historyId || this.removed().has(comment.historyId)) return;
        const validated = readCoachFollowUp(answer);
        if (!validated) return;
        const id = comment.historyId;
        let pending = this.queue.get(id);
        if (!pending) {
            // Already recorded: updates never reinsert a deleted observation.
            pending = { scope: this.access.capture(), row: observationToHistory(comment), inserted: true, answers: {}, failed: false };
            this.queue.set(id, pending);
        }
        const column = question === 'explain' ? 'explanation' : 'session_comparison';
        pending.answers[column] = validated;
        void this.flush(id);
    }

    retrySaves(): void {
        if (this.canReview()) for (const [id, pending] of this.queue) if (pending.failed) void this.flush(id);
    }

    /** A typed reply must wait for its original observation to be available to the server. */
    async ensureSaved(id: string): Promise<boolean> {
        if (!this.canReview() || this.removed().has(id)) return false;
        const scope = this.access.capture();
        await this.flush(id);
        return this.current(scope) && !this.removed().has(id) && this.queue.get(id)?.inserted !== false;
    }

    async load(date = this.date(), more = false): Promise<void> {
        if (!this.canReview() || (more && (this.loading() || !this.hasMore()))) return;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const scope = this.access.capture(), request = ++this.request;
        const cursor = more ? this.cursor : null;
        this.date.set(date); this.loading.set(true); this.error.set(null);
        if (!more) { this.items.set([]); this.hasMore.set(false); this.cursor = null; this.loaded = false; }
        try {
            let query = this.client.from('live_coach_history').select(HISTORY_COLUMNS).eq('user_id', scope.userId)
                .order('observed_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1);
            if (date) query = query.eq('trade_date', date);
            // Keyset pagination avoids skipping rows when new observations arrive.
            if (cursor) query = query.or(`observed_at.lt.${cursor.observed_at},and(observed_at.eq.${cursor.observed_at},id.lt.${cursor.id})`);
            const { data, error } = await query.abortSignal(this.requestSignal(scope));
            if (!this.current(scope) || request !== this.request) return;
            if (error) throw error;
            const rows = (data ?? []) as unknown as SavedCoachObservation[];
            this.hasMore.set(rows.length > HISTORY_PAGE_SIZE);
            const page = rows.slice(0, HISTORY_PAGE_SIZE).map(readHistoryRow);
            this.cursor = page.at(-1) ?? cursor;
            this.loaded = true;
            this.merge(page);
        } catch {
            if (this.current(scope) && request === this.request) this.error.set('Could not load saved history. Try again.');
        } finally {
            if (this.current(scope) && request === this.request) this.loading.set(false);
        }
    }

    async remove(id: string): Promise<boolean> {
        if (!this.canReview() || this.deleting()) return false;
        const scope = this.access.capture();
        this.deleting.set(id); this.error.set(null);
        // Stop queued writes before deleting; wait for any already dispatched write.
        this.removed.update(ids => new Set([...ids, id]));
        const pending = this.queue.get(id);
        try {
            await pending?.running;
            if (!this.current(scope)) return false;
            const { error } = await this.client.from('live_coach_history').delete()
                .eq('user_id', scope.userId).eq('id', id).abortSignal(this.requestSignal(scope));
            if (!this.current(scope)) return false;
            if (error) throw error;
            this.queue.delete(id); this.updateCounts();
            this.items.update(items => items.filter(item => item.id !== id));
            return true;
        } catch {
            if (this.current(scope)) {
                this.removed.update(ids => { const next = new Set(ids); next.delete(id); return next; });
                if (pending) { pending.failed = true; this.updateCounts(); }
                this.error.set('Could not delete this observation. Try again.');
            }
            return false;
        } finally { if (this.current(scope)) this.deleting.set(null); }
    }

    private flush(id: string): Promise<void> {
        const pending = this.queue.get(id);
        if (!pending || !this.current(pending.scope) || this.removed().has(id)) return Promise.resolve();
        if (pending.running) return pending.running;
        pending.failed = false;
        pending.running = this.write(id, pending).finally(() => {
            pending.running = undefined;
            if (this.queue.get(id) === pending) {
                if (!pending.failed && Object.keys(pending.answers).length === 0) this.queue.delete(id);
                this.updateCounts();
                if (!pending.failed && this.queue.has(id) && !this.removed().has(id)) void this.flush(id);
            }
        });
        this.updateCounts();
        return pending.running;
    }

    private async write(id: string, pending: PendingSave): Promise<void> {
        const { scope, row } = pending;
        try {
            if (!pending.inserted) {
                // Retry the same UUID without overwriting existing follow-ups.
                const { error } = await this.client.from('live_coach_history')
                    .upsert({ ...row, user_id: scope.userId }, { onConflict: 'user_id,id', ignoreDuplicates: true }).abortSignal(this.requestSignal(scope));
                if (error) throw error;
                pending.inserted = true;
            }
            while (this.current(scope) && !this.removed().has(id) && Object.keys(pending.answers).length) {
                const answers = { ...pending.answers };
                const { data, error } = await this.client.from('live_coach_history').update(answers)
                    .eq('user_id', scope.userId).eq('id', id).select('id').abortSignal(this.requestSignal(scope)).maybeSingle();
                if (error || !data) throw error || new Error('The saved observation no longer exists.');
                Object.assign(row, answers);
                for (const column of Object.keys(answers) as AnswerColumn[]) {
                    if (pending.answers[column] === answers[column]) delete pending.answers[column];
                }
            }
            if (this.current(scope) && !this.removed().has(id) && this.loaded) this.merge([row]);
        } catch {
            if (this.current(scope)) pending.failed = true;
        }
    }

    private merge(rows: SavedCoachObservation[]): void {
        const all = new Map(this.items().map(row => [row.id, row]));
        for (const row of rows) {
            if (this.removed().has(row.id) || (this.date() && row.trade_date !== this.date())) continue;
            const previous = all.get(row.id);
            all.set(row.id, { ...row, explanation: row.explanation ?? previous?.explanation ?? null,
                session_comparison: row.session_comparison ?? previous?.session_comparison ?? null });
        }
        this.items.set([...all.values()].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || b.id.localeCompare(a.id)));
    }

    private current(scope: UserOperation): boolean { return this.canReview() && this.session.isCurrent(scope); }
    private requestSignal(scope: UserOperation): AbortSignal { return AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]); }
    private updateCounts(): void {
        this.pendingCount.set(this.queue.size);
        this.failedCount.set([...this.queue.values()].filter(pending => pending.failed).length);
    }
}
