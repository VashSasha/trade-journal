import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { FilterService } from '../../../core/services/filter.service';
import { OpenAiService } from '../../../core/services/openai.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TradeService } from '../../../core/services/trade.service';
import { UserDataService } from '../../../core/services/user-data/user-data.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { tradeSessionDateStr } from '../../../core/utils/market-holidays';
import { captureChatContext, CoachChatObservation, CoachChatRequest, CoachChatTurn, CoachConversation } from './coach-chat.model';
import { CoachHistoryService } from '../history/coach-history.service';
import { captureCoachSnapshot } from '../history/coach-history.model';
import { LiveCoachObservation } from '../live-coach.models';

/** Widget-scoped drafts; completed exchanges are server-saved. Never speaks automatically. */
@Injectable()
export class CoachChatService {
    private readonly client = inject(SupabaseService).client;
    readonly access = inject(AccessPolicyService);
    private readonly session = inject(UserSessionService);
    private readonly ai = inject(OpenAiService);
    private readonly trades = inject(TradeService);
    private readonly filters = inject(FilterService);
    private readonly data = inject(UserDataService);
    private readonly history = inject(CoachHistoryService);
    readonly conversations = signal<CoachConversation[]>([]);
    readonly conversationId = signal<string | null>(null);
    readonly turns = signal<CoachChatTurn[]>([]);
    readonly draft = signal('');
    readonly replyTo = signal<CoachChatObservation | null>(null);
    readonly day = signal(tradeSessionDateStr(new Date().toISOString()));
    readonly loading = signal(false);
    readonly listing = signal(false);
    readonly hasMore = signal(false);
    readonly busy = signal(false);
    readonly deleting = signal(false);
    readonly error = signal<string | null>(null);
    readonly listError = signal<string | null>(null);
    readonly pending = signal<CoachChatRequest | null>(null);
    readonly allowance = signal<{ day: string; remaining: number } | null>(null);
    readonly canReview = computed(() => !!this.session.userId() && !this.access.demo());
    readonly accountIds = computed(() => this.filters.filters().accountSelectionActive ? [...this.filters.filters().accountIds] : null);
    readonly dataReady = this.data.dataLoaded;
    private generation = 0;
    private listGeneration = 0;
    private controller: AbortController | null = null;

    constructor() {
        let owner = this.session.userId(), demo = this.access.demo(), allowed = this.access.canAct('ai');
        effect(() => {
            const nextOwner = this.session.userId(), nextDemo = this.access.demo();
            if (owner === nextOwner && demo === nextDemo) return;
            owner = nextOwner; demo = nextDemo;
            untracked(() => {
                this.cancel(false); this.listGeneration++;
                this.conversations.set([]); this.conversationId.set(null); this.turns.set([]); this.draft.set('');
                this.pending.set(null); this.replyTo.set(null); this.error.set(null); this.listError.set(null); this.allowance.set(null);
                this.loading.set(false); this.listing.set(false); this.hasMore.set(false); this.deleting.set(false);
                this.day.set(tradeSessionDateStr(new Date().toISOString()));
            });
        });
        effect(() => {
            const next = this.access.canAct('ai');
            if (allowed && !next) untracked(() => this.cancel());
            allowed = next;
        });
        inject(DestroyRef).onDestroy(() => this.cancel(false));
    }

    async initialize(): Promise<void> { await Promise.all([this.loadConversations(), this.refreshAllowance()]); }

    async loadConversations(more = false): Promise<void> {
        if (!this.canReview() || (more && (this.listing() || !this.hasMore()))) return;
        const scope = this.access.capture(), revision = ++this.listGeneration;
        const cursor = more ? this.conversations().at(-1) : null;
        this.listing.set(true); this.listError.set(null);
        try {
            let query = this.client.from('coach_conversations').select('id,title,created_at').eq('user_id', scope.userId)
                .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(31);
            if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
            const { data, error } = await query.abortSignal(this.signal(scope));
            if (!this.current(scope) || revision !== this.listGeneration) return;
            if (error) throw error;
            const rows = data as CoachConversation[];
            this.hasMore.set(rows.length > 30);
            const items = new Map((more ? this.conversations() : []).map(item => [item.id, item]));
            for (const row of rows.slice(0, 30)) items.set(row.id, row);
            this.conversations.set([...items.values()]);
        } catch { if (this.current(scope) && revision === this.listGeneration) this.listError.set('Could not load conversations. Try refreshing.'); }
        finally { if (this.current(scope) && revision === this.listGeneration) this.listing.set(false); }
    }

    async refreshAllowance(): Promise<void> {
        if (!this.canReview()) return;
        const scope = this.access.capture(), day = new Date().toISOString().slice(0, 10);
        try {
            const { data, error } = await this.client.from('live_coach_ai_usage').select('count').eq('user_id', scope.userId)
                .eq('day', day).abortSignal(this.signal(scope)).maybeSingle();
            if (this.current(scope)) this.allowance.set(error ? null : { day, remaining: Math.max(0, 30 - (data?.count ?? 0)) });
        } catch { if (this.current(scope)) this.allowance.set(null); }
    }

    newConversation(): void {
        if (this.busy() || this.deleting()) return;
        this.cancel(false); this.conversationId.set(null); this.turns.set([]); this.draft.set('');
        this.pending.set(null); this.replyTo.set(null); this.error.set(null); this.loading.set(false);
    }

    reply(comment: LiveCoachObservation): void {
        if (!this.access.canAct('ai') || !this.canReview() || this.pending() || this.loading() || !comment.historyId) return;
        this.replyTo.set({ id: comment.historyId, observedAt: new Date(comment.time).toISOString(), title: comment.title,
            text: comment.text, snapshot: captureCoachSnapshot(comment.snapshot) });
    }

    async open(id: string): Promise<void> {
        if (!this.canReview() || this.busy() || this.deleting() || !id) return;
        const same = id === this.conversationId();
        this.cancel(false);
        const scope = this.access.capture(), revision = this.generation;
        this.conversationId.set(id); this.turns.set([]); this.error.set(null); this.loading.set(true);
        if (!same) { this.draft.set(''); this.pending.set(null); this.replyTo.set(null); }
        try {
            const { data, error } = await this.client.from('coach_chat_turns').select('id,conversation_id,prompt,answer,context,created_at')
                .eq('user_id', scope.userId).eq('conversation_id', id)
                .order('created_at').order('id').limit(100).abortSignal(this.signal(scope));
            if (!this.current(scope) || revision !== this.generation) return;
            if (error) throw error;
            this.turns.set(data as CoachChatTurn[]);
            if (this.turns().some(turn => turn.id === this.pending()?.turnId)) { this.pending.set(null); this.draft.set(''); this.replyTo.set(null); }
        } catch { if (this.current(scope) && revision === this.generation) this.error.set('Could not load this conversation. Refresh before sending.'); }
        finally { if (this.current(scope) && revision === this.generation) this.loading.set(false); }
    }

    async send(retry = false): Promise<void> {
        if (!this.canReview() || !this.access.canAct('ai') || this.busy() || this.loading() || this.deleting()) return;
        const message = this.draft().trim();
        if (!retry && (!message || message.length > 1000 || this.pending())) return;
        const scope = this.access.capture();
        const request = retry ? this.pending() : { conversationId: this.conversationId() ?? crypto.randomUUID(), turnId: crypto.randomUUID(), message,
            context: { ...captureChatContext(this.trades.trades(), scope.userId, this.day(), this.accountIds(), this.dataReady()),
                ...(this.replyTo() ? { replyTo: this.replyTo()! } : {}) } };
        if (!request) return;
        const revision = ++this.generation, controller = new AbortController();
        this.controller = controller; this.busy.set(true); this.error.set(null); this.pending.set(request);
        const deadline = setTimeout(() => controller.abort(), 45_000);
        const signal = AbortSignal.any([scope.signal, controller.signal]);
        try {
            if (request.context.replyTo && !await this.waitForAnswer(() => this.history.ensureSaved(request.context.replyTo!.id), signal)) {
                throw new Error('The original update has not saved. Retry saving it before replying.');
            }
            signal.throwIfAborted();
            // Retrying the same UUID never overwrites a conversation or creates a second answer.
            if (!this.conversationId()) {
                const { error } = await this.client.from('coach_conversations').upsert({ id: request.conversationId, user_id: scope.userId,
                    title: request.message.slice(0, 80) }, { onConflict: 'user_id,id', ignoreDuplicates: true }).abortSignal(signal);
                if (error) throw new Error('Could not create a conversation. Please retry.');
                if (!this.current(scope) || revision !== this.generation) return;
                this.conversationId.set(request.conversationId);
            }
            signal.throwIfAborted();
            const answer = await this.waitForAnswer(() => this.ai.askCoach(request, signal), signal);
            if (!this.current(scope) || revision !== this.generation || signal.aborted || !this.access.canAct('ai')) return;
            this.turns.update(turns => [...turns.filter(turn => turn.id !== request.turnId), {
                id: request.turnId, conversation_id: request.conversationId, prompt: request.message, answer,
                context: request.context, created_at: new Date().toISOString(),
            }]);
            this.pending.set(null); this.replyTo.set(null); this.draft.set('');
            void this.loadConversations();
        } catch (error) {
            if (this.current(scope) && revision === this.generation) this.error.set(signal.aborted
                ? 'The request timed out. Refresh to check for a saved answer, or retry this message.'
                : error instanceof Error ? error.message : 'Could not get an answer. Please retry.');
        } finally {
            clearTimeout(deadline);
            if (revision === this.generation) { this.busy.set(false); this.controller = null; }
            if (this.current(scope)) void this.refreshAllowance();
        }
    }

    cancel(showMessage = true): void {
        this.generation++; this.controller?.abort(); this.controller = null;
        if (this.busy() && showMessage) this.error.set('Stopped waiting. An answer may still save; refresh this conversation before retrying.');
        this.busy.set(false);
    }

    discardPending(): void { if (!this.busy()) { this.pending.set(null); this.error.set(null); } }

    async remove(): Promise<void> {
        const id = this.conversationId();
        if (!id || !this.canReview() || this.deleting() || this.busy()) return;
        const scope = this.access.capture();
        this.deleting.set(true); this.error.set(null);
        try {
            const { error } = await this.client.from('coach_conversations').delete().eq('user_id', scope.userId).eq('id', id).abortSignal(this.signal(scope));
            if (!this.current(scope)) return;
            if (error) throw error;
            this.deleting.set(false); this.newConversation();
            this.conversations.update(items => items.filter(item => item.id !== id));
        } catch { if (this.current(scope)) this.error.set('Could not delete this conversation. Please retry.'); }
        finally { if (this.current(scope)) this.deleting.set(false); }
    }

    private current(scope: UserOperation): boolean { return this.canReview() && this.session.isCurrent(scope); }
    private signal(scope: UserOperation): AbortSignal { return AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]); }
    private async waitForAnswer<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
        signal.throwIfAborted();
        let abort!: () => void;
        try {
            const cancelled = new Promise<never>((_, reject) => {
                abort = () => reject(new Error('Request cancelled.'));
                signal.addEventListener('abort', abort, { once: true });
            });
            return await Promise.race([request(), cancelled]);
        } finally { signal.removeEventListener('abort', abort); }
    }
}
