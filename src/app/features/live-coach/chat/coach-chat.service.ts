import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { FilterService } from '../../../core/services/filter.service';
import { OpenAiService } from '../../../core/services/openai.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TradeService } from '../../../core/services/trade.service';
import { UserDataService } from '../../../core/services/user-data/user-data.service';
import { readCache } from '../../../core/services/user-data/user-data.cache';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { tradeSessionDateStr } from '../../../core/utils/market-holidays';
import { captureChatContext, CoachChatObservation, CoachChatRequest, CoachChatTurn, CoachConversation } from './coach-chat.model';
import { CoachHistoryService } from '../history/coach-history.service';
import { captureCoachSnapshot } from '../history/coach-history.model';
import { LiveCoachObservation } from '../live-coach.models';

const MENU_CACHE_MS = 30_000;
const SELECTION_KEY = 'nvzn_coach_selected_chat:';
const CONVERSATION_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

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
    readonly conversationTitle = signal<string | null>(null);
    readonly turns = signal<CoachChatTurn[]>([]);
    readonly draft = signal('');
    readonly replyTo = signal<CoachChatObservation | null>(null);
    readonly day = signal(tradeSessionDateStr(new Date().toISOString()));
    readonly loading = signal(false);
    readonly loadFailed = signal(false);
    readonly notice = signal<string | null>(null);
    readonly storageWarning = signal(false);
    readonly listing = signal(false);
    readonly hasMore = signal(false);
    readonly busy = signal(false);
    readonly deleting = signal(false);
    readonly error = signal<string | null>(null);
    readonly listError = signal<string | null>(null);
    readonly pending = signal<CoachChatRequest | null>(null);
    readonly allowance = signal<{ day: string; remaining: number } | null>(null);
    readonly allowanceLoading = signal(false);
    readonly canReview = computed(() => !!this.session.userId() && !this.access.demo());
    readonly canReply = computed(() => this.canReview() && this.access.canAct('ai')
        && !this.pending() && !this.busy() && !this.loading() && !this.loadFailed() && !this.deleting());
    readonly accountIds = computed(() => this.filters.filters().accountSelectionActive ? [...this.filters.filters().accountIds] : null);
    readonly dataReady = this.data.dataLoaded;
    private generation = 0;
    private listGeneration = 0;
    private listLoadedAt: number | null = null;
    private allowanceLoadedAt: number | null = null;
    private allowanceGeneration = 0;
    private allowanceRequest: Promise<void> | null = null;
    private allowanceRequestDay: string | null = null;
    private controller: AbortController | null = null;
    private selectionInitialized = false;

    constructor() {
        let owner = this.session.userId(), demo = this.access.demo(), allowed = this.access.canAct('ai');
        effect(() => {
            const nextOwner = this.session.userId(), nextDemo = this.access.demo();
            if (owner === nextOwner && demo === nextDemo) return;
            owner = nextOwner; demo = nextDemo;
            untracked(() => {
                this.cancel(false); this.invalidateConversations(); this.invalidateAllowance();
                this.conversations.set([]); this.conversationId.set(null); this.turns.set([]); this.draft.set('');
                this.conversationTitle.set(null); this.selectionInitialized = false;
                this.loadFailed.set(false); this.notice.set(null); this.storageWarning.set(false);
                this.pending.set(null); this.replyTo.set(null); this.error.set(null); this.listError.set(null); this.allowance.set(null);
                this.loading.set(false); this.listing.set(false); this.hasMore.set(false); this.deleting.set(false);
                this.day.set(tradeSessionDateStr(new Date().toISOString()));
            });
        });
        effect(() => {
            const next = this.access.canAct('ai');
            // Losing AI access cancels generation, not an ordinary read of saved history.
            if (allowed && !next && untracked(this.busy)) untracked(() => this.cancel());
            allowed = next;
        });
        inject(DestroyRef).onDestroy(() => {
            this.cancel(false); this.invalidateConversations(); this.invalidateAllowance();
        });
    }

    /** Called on widget open, not app startup. Only a UUID is kept locally, never chat content. */
    async resume(): Promise<void> {
        if (!this.canReview() || this.selectionInitialized) return;
        this.selectionInitialized = true;
        const id = readCache<unknown>(SELECTION_KEY + this.session.userId());
        if (typeof id === 'string' && CONVERSATION_ID.test(id)) await this.open(id);
    }

    /** Only requested by the Saved chats menu. Cache survives closing the widget. */
    async loadConversations(more = false, force = false): Promise<void> {
        if (!this.canReview() || this.listing() || (more && !this.hasMore())) return;
        if (!more && !force && this.listLoadedAt !== null && Date.now() - this.listLoadedAt < MENU_CACHE_MS) return;
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
            // Loading older pages must not prolong freshness of the newest page.
            if (!more) this.listLoadedAt = Date.now();
        } catch {
            if (this.current(scope) && revision === this.listGeneration) {
                this.listLoadedAt = null;
                this.listError.set('Could not load conversations. Try refreshing.');
            }
        }
        finally { if (this.current(scope) && revision === this.listGeneration) this.listing.set(false); }
    }

    refreshAllowance(force = false): Promise<void> {
        if (!this.canReview()) return Promise.resolve();
        const scope = this.access.capture(), day = new Date().toISOString().slice(0, 10);
        if (this.allowanceRequest && this.allowanceRequestDay === day) return this.allowanceRequest;
        if (!force && this.allowance()?.day === day && this.allowanceLoadedAt !== null
            && Date.now() - this.allowanceLoadedAt < MENU_CACHE_MS) return Promise.resolve();
        const revision = ++this.allowanceGeneration;
        this.allowance.set(null); this.allowanceLoading.set(true);
        this.allowanceRequestDay = day;
        return this.allowanceRequest = this.loadAllowance(scope, day, revision);
    }

    /** Shared quota may change after any attempted chat or speech request. Re-read on demand. */
    invalidateAllowance(): void {
        this.allowanceGeneration++; this.allowanceLoadedAt = null;
        this.allowanceRequest = null; this.allowanceRequestDay = null;
        this.allowance.set(null); this.allowanceLoading.set(false);
    }

    private async loadAllowance(scope: UserOperation, day: string, revision: number): Promise<void> {
        try {
            const { data, error } = await this.client.from('live_coach_ai_usage').select('count').eq('user_id', scope.userId)
                .eq('day', day).abortSignal(this.signal(scope)).maybeSingle();
            if (!this.current(scope) || revision !== this.allowanceGeneration) return;
            if (error) throw error;
            // Do not label yesterday's result as today's balance if a read crosses midnight.
            if (day !== new Date().toISOString().slice(0, 10)) return;
            this.allowance.set({ day, remaining: Math.max(0, 30 - (data?.count ?? 0)) });
            this.allowanceLoadedAt = Date.now();
        } catch {
            if (this.current(scope) && revision === this.allowanceGeneration) {
                this.allowance.set(null); this.allowanceLoadedAt = null;
            }
        } finally {
            if (revision === this.allowanceGeneration) {
                this.allowanceRequest = null; this.allowanceRequestDay = null; this.allowanceLoading.set(false);
            }
        }
    }

    newConversation(): void {
        if (this.busy() || this.deleting()) return;
        this.resetConversation(); this.rememberSelection(null);
    }

    private resetConversation(): void {
        this.cancel(false); this.conversationId.set(null); this.turns.set([]); this.draft.set('');
        this.pending.set(null); this.replyTo.set(null); this.error.set(null); this.loading.set(false);
        this.conversationTitle.set(null); this.loadFailed.set(false); this.notice.set(null);
        this.selectionInitialized = true;
    }

    reply(comment: LiveCoachObservation, tradeDate?: string): boolean {
        if (!this.canReply() || !comment.historyId || this.history.removed().has(comment.historyId)) return false;
        this.replyTo.set({ id: comment.historyId, observedAt: new Date(comment.time).toISOString(), title: comment.title,
            text: comment.text, snapshot: captureCoachSnapshot(comment.snapshot) });
        this.day.set(tradeDate ?? comment.snapshot?.session.tradeDate ?? tradeSessionDateStr(new Date(comment.time).toISOString()));
        return true;
    }

    async open(id: string): Promise<void> {
        if (!this.canReview() || this.busy() || this.deleting() || !id) return;
        const same = id === this.conversationId();
        const restoreDay = !same || this.loadFailed();
        this.cancel(false);
        this.selectionInitialized = true;
        const scope = this.access.capture(), revision = this.generation;
        this.conversationId.set(id); this.turns.set([]); this.error.set(null); this.loading.set(true);
        this.conversationTitle.set(null); this.loadFailed.set(false); this.notice.set(null);
        if (!same) { this.draft.set(''); this.pending.set(null); this.replyTo.set(null); }
        try {
            // Read the parent and its bounded history together: an empty chat is not a deleted chat.
            const { data, error } = await this.client.from('coach_conversations')
                .select('id,title,coach_chat_turns(id,conversation_id,prompt,answer,context,created_at)')
                .eq('user_id', scope.userId).eq('id', id)
                .order('created_at', { referencedTable: 'coach_chat_turns' })
                .order('id', { referencedTable: 'coach_chat_turns' })
                .limit(100, { referencedTable: 'coach_chat_turns' }).abortSignal(this.signal(scope)).maybeSingle();
            if (!this.current(scope) || revision !== this.generation) return;
            if (error) throw error;
            if (!data) {
                // Forget only this missing selection, not a different chat selected in another tab.
                this.rememberSelection(null, id);
                this.conversationId.set(null); this.conversationTitle.set(null);
                this.pending.set(null); this.replyTo.set(null);
                this.notice.set('That chat is no longer available. Start a new chat or choose another from Saved chats.');
                return;
            }
            this.turns.set(data.coach_chat_turns as CoachChatTurn[]);
            this.conversationTitle.set(data.title);
            this.rememberSelection(id);
            if (restoreDay && this.turns().length) this.day.set(this.turns().at(-1)!.context.tradeDate);
            if (this.turns().some(turn => turn.id === this.pending()?.turnId)) { this.pending.set(null); this.draft.set(''); this.replyTo.set(null); }
        } catch {
            if (this.current(scope) && revision === this.generation) {
                this.loadFailed.set(true);
                this.error.set('Could not load this conversation. Retry loading before sending.');
            }
        }
        finally { if (this.current(scope) && revision === this.generation) this.loading.set(false); }
    }

    async send(retry = false): Promise<void> {
        if (!this.canReview() || !this.access.canAct('ai') || this.busy() || this.loading() || this.loadFailed() || this.deleting()) return;
        this.selectionInitialized = true;
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
                this.conversationTitle.set(request.message.slice(0, 80));
                this.rememberSelection(request.conversationId);
                this.notice.set(null);
                this.invalidateConversations();
            }
            signal.throwIfAborted();
            const answer = await this.waitForAnswer(() => this.ai.askCoach(request, signal), signal);
            if (!this.current(scope) || revision !== this.generation || signal.aborted || !this.access.canAct('ai')) return;
            this.turns.update(turns => [...turns.filter(turn => turn.id !== request.turnId), {
                id: request.turnId, conversation_id: request.conversationId, prompt: request.message, answer,
                context: request.context, created_at: new Date().toISOString(),
            }]);
            this.pending.set(null); this.replyTo.set(null); this.draft.set('');
        } catch (error) {
            if (this.current(scope) && revision === this.generation) this.error.set(signal.aborted
                ? 'The request timed out. Refresh to check for a saved answer, or retry this message.'
                : error instanceof Error ? error.message : 'Could not get an answer. Please retry.');
        } finally {
            clearTimeout(deadline);
            if (revision === this.generation) { this.busy.set(false); this.controller = null; }
            if (this.current(scope)) this.invalidateAllowance();
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
            this.deleting.set(false); this.resetConversation(); this.rememberSelection(null, id);
            this.invalidateConversations();
            this.conversations.update(items => items.filter(item => item.id !== id));
        } catch { if (this.current(scope)) this.error.set('Could not delete this conversation. Please retry.'); }
        finally { if (this.current(scope)) this.deleting.set(false); }
    }

    private invalidateConversations(): void {
        // Ignore reads started before a create/delete, even if they finish afterwards.
        this.listGeneration++; this.listLoadedAt = null; this.listing.set(false);
    }

    private rememberSelection(id: string | null, onlyIf?: string): void {
        if (!this.canReview()) return;
        const key = SELECTION_KEY + this.session.userId();
        try {
            if (onlyIf && readCache<unknown>(key) !== onlyIf) return;
            if (id) localStorage.setItem(key, JSON.stringify(id));
            else localStorage.removeItem(key);
            this.storageWarning.set(false);
        } catch { this.storageWarning.set(true); }
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
