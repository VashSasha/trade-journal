import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { FilterService } from '../../../core/services/filter.service';
import { OpenAiService } from '../../../core/services/openai.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TradeService } from '../../../core/services/trade.service';
import { UserDataService } from '../../../core/services/user-data/user-data.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { CoachChatRequest } from './coach-chat.model';
import { CoachChatService } from './coach-chat.service';
import { CoachHistoryService } from '../history/coach-history.service';

const answer = { meaning: 'Review sizing.', evidence: 'No saved history for this selection.', nextStep: 'Write your session plan.' };
interface Call { table: string; operation: string; filters: Record<string, unknown>; body?: any; }
function setup() {
    const userId = signal<string | null>('owner'), demo = signal(false), allowed = signal(true);
    let controller = new AbortController();
    let rows: any[] = [];
    let fail = false;
    const calls: Call[] = [];
    const deferred = new Map<string, Promise<any>[]>();
    const from = vi.fn((table: string) => {
        const call: Call = { table, operation: 'select', filters: {} };
        const query = {
            select: () => query, order: () => query, limit: () => query, maybeSingle: () => query,
            or: (cursor: string) => { call.filters['cursor'] = cursor; return query; },
            eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
            upsert: (body: any, options: any) => { expect(options.ignoreDuplicates).toBe(true); call.body = body; call.operation = 'upsert'; return query; },
            delete: () => { call.operation = 'delete'; return query; }, abortSignal: () => query,
            then: (resolve: (result: any) => unknown, reject: (error: unknown) => unknown) => {
                calls.push(call);
                const held = call.operation === 'select' ? deferred.get(table)?.shift() : undefined;
                return (held ?? Promise.resolve({ data: table === 'live_coach_ai_usage' ? { count: 4 } : rows, error: fail ? new Error('offline') : null })).then(resolve, reject);
            },
        };
        return query;
    });
    const askCoach = vi.fn(async (_request: CoachChatRequest, _signal: AbortSignal) => answer);
    const ensureSaved = vi.fn(async (_id: string) => true);
    TestBed.configureTestingModule({ providers: [CoachChatService,
        { provide: SupabaseService, useValue: { client: { from } } },
        { provide: UserSessionService, useValue: { userId, isCurrent: (scope: UserOperation) => scope.userId === userId() && !scope.signal.aborted } },
        { provide: AccessPolicyService, useValue: { demo, canAct: () => allowed() && !demo(), capture: () => ({ userId: userId()!, signal: controller.signal }) } },
        { provide: OpenAiService, useValue: { askCoach } },
        { provide: CoachHistoryService, useValue: { ensureSaved } },
        { provide: TradeService, useValue: { trades: signal([]) } },
        { provide: FilterService, useValue: { filters: signal({ accountIds: ['a'], accountSelectionActive: true }) } },
        { provide: UserDataService, useValue: { dataLoaded: signal(false) } },
    ] });
    const service = TestBed.inject(CoachChatService); TestBed.tick();
    return { service, askCoach, ensureSaved, calls, from, demo, allowed, setRows: (value: any[]) => { rows = value; }, fail: (value = true) => { fail = value; },
        holdRead: (table: string) => {
            let resolve!: (result: any) => void;
            const promise = new Promise(done => { resolve = done; });
            deferred.set(table, [...(deferred.get(table) ?? []), promise]);
            return resolve;
        },
        switchUser: (id: string | null) => { controller.abort(); controller = new AbortController(); userId.set(id); TestBed.tick(); } };
}
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
describe('Ask Coach state', () => {
    it('keeps the original observation across retries and sends only after it is saved', async () => {
        const { service, askCoach, ensureSaved, switchUser } = setup();
        const comment = { id: 1, historyId: 'saved-observation', time: 1000, title: 'Position increased', text: 'Now 3 contracts.', personalized: false };
        service.reply(comment); expect(askCoach).not.toHaveBeenCalled();
        ensureSaved.mockResolvedValueOnce(false);
        service.draft.set('What changed?'); await service.send();
        expect(askCoach).not.toHaveBeenCalled(); expect(service.error()).toContain('original update has not saved');
        comment.text = 'A newer event'; service.day.set('2026-09-01');
        await service.send(true);
        expect(ensureSaved).toHaveBeenCalledWith('saved-observation');
        expect(askCoach.mock.calls[0][0].context.replyTo).toMatchObject({ text: 'Now 3 contracts.', observedAt: '1970-01-01T00:00:01.000Z' });
        expect(service.turns()[0].context.replyTo?.text).toBe('Now 3 contracts.');
        expect(service.replyTo()).toBeNull();
        service.reply(comment); switchUser('other'); expect(service.replyTo()).toBeNull();
    });
    it('does not call AI until Send; allows the first question without trade data and saves no client-forged answers', async () => {
        const { service, askCoach, calls } = setup();
        expect(calls).toHaveLength(0);
        expect(askCoach).not.toHaveBeenCalled();
        service.draft.set('Help me plan.'); await service.send();
        expect(askCoach).toHaveBeenCalledTimes(1);
        expect(askCoach.mock.calls[0][0].context).toMatchObject({ dataReady: false, summary: null, accountIds: ['a'] });
        expect(service.turns()[0].answer).toEqual(answer);
        expect(calls.find(c => c.operation === 'upsert')?.body.user_id).toBe('owner');
        expect(calls.some(c => c.table === 'coach_chat_turns' && c.operation !== 'select')).toBe(false);
        expect(calls.filter(c => c.operation === 'select')).toEqual([]);
        expect(service.allowance()).toBeNull();
        await service.refreshAllowance(); expect(service.allowance()?.remaining).toBe(26);
    });
    it('retries with the identical question ID and captured context, even if the selected day changes', async () => {
        const { service, askCoach } = setup();
        askCoach.mockRejectedValueOnce(new Error('offline'));
        service.draft.set('Review this day.'); await service.send();
        const request = askCoach.mock.calls[0][0];
        service.day.set('2026-09-01'); await service.send(true);
        expect(askCoach.mock.calls[1][0]).toEqual(request);
        expect(service.turns()).toHaveLength(1);
        expect(service.pending()).toBeNull();
    });
    it('suppresses repeated sends, cancels without stale completion, and recovers a saved answer on refresh', async () => {
        const { service, askCoach, setRows } = setup();
        let resolve!: (value: typeof answer) => void;
        askCoach.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        service.draft.set('Plan my day.'); const running = service.send();
        await vi.waitFor(() => expect(askCoach).toHaveBeenCalledTimes(1));
        await service.send(); expect(askCoach).toHaveBeenCalledTimes(1);
        const request = service.pending()!;
        service.cancel(); resolve(answer); await running;
        expect(service.turns()).toHaveLength(0);
        setRows([{ id: request.turnId, conversation_id: request.conversationId, prompt: request.message, context: request.context, answer }]);
        await service.open(request.conversationId);
        expect(service.turns()).toHaveLength(1); expect(service.pending()).toBeNull();
        expect(askCoach).toHaveBeenCalledTimes(1);
    });
    it('clears private state and ignores in-flight responses after switching users', async () => {
        const { service, askCoach, switchUser } = setup();
        let resolve!: (value: typeof answer) => void;
        askCoach.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        service.draft.set('Private question'); const running = service.send();
        await vi.waitFor(() => expect(askCoach).toHaveBeenCalledTimes(1));
        switchUser('other'); resolve(answer); await running;
        expect(service.turns()).toEqual([]); expect(service.draft()).toBe(''); expect(service.pending()).toBeNull();
        expect(service.conversationId()).toBeNull();
    });
    it('allows read/delete after downgrade but blocks new AI and all demo operations', async () => {
        const { service, askCoach, allowed, demo, calls } = setup();
        allowed.set(false); TestBed.tick();
        await service.open('thread'); service.draft.set('Question'); await service.send();
        expect(askCoach).not.toHaveBeenCalled(); await service.remove();
        expect(calls.find(c => c.operation === 'delete')?.filters).toEqual({ user_id: 'owner', id: 'thread' });
        expect(calls.every(c => c.operation !== 'delete' || c.table === 'coach_conversations')).toBe(true);
        calls.length = 0; demo.set(true); TestBed.tick();
        await service.loadConversations(); await service.refreshAllowance(); await service.open('thread'); await service.send();
        expect(calls).toEqual([]);
    });
    it('does not display an invented full allowance when the usage read fails', async () => {
        const { service, fail } = setup(); fail(); await service.refreshAllowance(); expect(service.allowance()).toBeNull();
    });

    it('ends the loading state even when an underlying auth or AI promise never settles', async () => {
        const { service, askCoach } = setup();
        vi.useFakeTimers(); askCoach.mockImplementationOnce(() => new Promise(() => {}));
        service.draft.set('Question'); const running = service.send();
        await vi.advanceTimersByTimeAsync(45_001); await running;
        expect(service.busy()).toBe(false); expect(service.error()).toContain('timed out');
        expect(service.pending()).not.toBeNull(); expect(service.turns()).toEqual([]);
    });
});

describe('Coach menu reads', () => {
    const thread = (id: string) => ({ id, title: id, created_at: '2026-09-28T12:00:00Z' });

    it('caches menu reads for 30 seconds, with explicit refresh and no AI requests', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
        const { service, calls, askCoach, setRows } = setup(); setRows([thread('first')]);
        expect(calls).toEqual([]);
        await service.loadConversations(); await service.refreshAllowance();
        await service.loadConversations(); await service.refreshAllowance();
        expect(calls).toHaveLength(2);
        await service.loadConversations(false, true); await service.refreshAllowance(true);
        expect(calls).toHaveLength(4);
        vi.setSystemTime(new Date('2026-09-28T12:00:31Z'));
        await service.loadConversations(); await service.refreshAllowance();
        expect(calls).toHaveLength(6);
        expect(askCoach).not.toHaveBeenCalled();
    });

    it('coalesces repeated reads while requests are pending', async () => {
        const { service, calls, holdRead } = setup();
        const listDone = holdRead('coach_conversations'), usageDone = holdRead('live_coach_ai_usage');
        const list = service.loadConversations(), usage = service.refreshAllowance();
        await service.loadConversations();
        expect(service.refreshAllowance()).toBe(usage);
        listDone({ data: [], error: null }); usageDone({ data: { count: 5 }, error: null });
        await Promise.all([list, usage]);
        expect(calls).toHaveLength(2); expect(service.allowance()?.remaining).toBe(25);
    });

    it('keeps loaded older pages when reopened and does not cache failed reads', async () => {
        const { service, setRows, calls, fail } = setup();
        setRows(Array.from({ length: 31 }, (_, i) => thread(`chat-${i}`)));
        await service.loadConversations(); expect(service.hasMore()).toBe(true);
        setRows([thread('older')]); await service.loadConversations(true);
        expect(calls[1].filters['cursor']).toContain('chat-29');
        expect(service.conversations()).toHaveLength(31); expect(service.hasMore()).toBe(false);
        await service.loadConversations(); expect(calls).toHaveLength(2);
        fail(); await service.loadConversations(false, true); await service.refreshAllowance();
        expect(service.listError()).toBeTruthy(); expect(service.allowance()).toBeNull();
        fail(false); await service.loadConversations(); await service.refreshAllowance();
        expect(calls).toHaveLength(6); expect(service.listError()).toBeNull(); expect(service.allowance()?.remaining).toBe(26);
    });

    it('invalidates menus after creating a chat even when AI fails, and reads them only on demand', async () => {
        const { service, calls, askCoach } = setup();
        await service.loadConversations(); await service.refreshAllowance();
        askCoach.mockRejectedValueOnce(new Error('offline'));
        service.draft.set('Plan'); await service.send();
        expect(service.allowance()).toBeNull();
        expect(calls.filter(c => c.operation === 'select')).toHaveLength(2);
        await service.loadConversations(); await service.refreshAllowance();
        expect(calls.filter(c => c.operation === 'select')).toHaveLength(4);
    });

    it('does not let a pre-delete list restore the removed chat', async () => {
        const { service, calls, setRows, holdRead } = setup();
        setRows([thread('deleted')]); await service.loadConversations();
        const done = holdRead('coach_conversations'); const pending = service.loadConversations(false, true);
        await Promise.resolve(); service.conversationId.set('deleted'); await service.remove();
        done({ data: [thread('deleted')], error: null }); await pending;
        expect(service.conversations()).toEqual([]);
        setRows([]); await service.loadConversations();
        expect(calls.filter(c => c.table === 'coach_conversations' && c.operation === 'select')).toHaveLength(3);
    });

    it('invalidates speech usage without fetching and ignores older in-flight usage results', async () => {
        const { service, calls, holdRead } = setup();
        const done = holdRead('live_coach_ai_usage'); const oldRead = service.refreshAllowance();
        await Promise.resolve(); service.invalidateAllowance();
        expect(service.allowance()).toBeNull(); expect(calls).toHaveLength(1);
        await service.refreshAllowance();
        done({ data: { count: 0 }, error: null }); await oldRead;
        expect(service.allowance()?.remaining).toBe(26); expect(calls).toHaveLength(2);
    });

    it('discards caches and late reads on owner/demo changes without automatically reloading', async () => {
        const { service, calls, switchUser, demo, holdRead, setRows } = setup();
        setRows([thread('private')]); await service.loadConversations(); await service.refreshAllowance();
        const listDone = holdRead('coach_conversations'), usageDone = holdRead('live_coach_ai_usage');
        const list = service.loadConversations(false, true), usage = service.refreshAllowance(true);
        await Promise.resolve(); switchUser('other');
        listDone({ data: [thread('private')], error: null }); usageDone({ data: { count: 25 }, error: null });
        await Promise.all([list, usage]);
        expect(service.conversations()).toEqual([]); expect(service.allowance()).toBeNull();
        setRows([]); await service.loadConversations(); await service.refreshAllowance();
        expect(calls.slice(-2).every(c => c.filters['user_id'] === 'other')).toBe(true);
        const beforeDemo = calls.length;
        demo.set(true); TestBed.tick();
        expect(service.allowance()).toBeNull(); expect(service.conversations()).toEqual([]);
        await service.loadConversations(); await service.refreshAllowance(); expect(calls).toHaveLength(beforeDemo);
        demo.set(false); TestBed.tick(); await service.loadConversations(); await service.refreshAllowance();
        expect(calls).toHaveLength(beforeDemo + 2);
    });

    it('refreshes at UTC midnight even with a fresh cache, and ignores results crossing midnight', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T23:59:59Z'));
        const { service, calls, holdRead } = setup();
        await service.refreshAllowance();
        const done = holdRead('live_coach_ai_usage'); const pending = service.refreshAllowance(true);
        await Promise.resolve(); vi.setSystemTime(new Date('2026-09-29T00:00:01Z'));
        done({ data: { count: 29 }, error: null }); await pending;
        expect(service.allowance()).toBeNull();
        await service.refreshAllowance();
        expect(service.allowance()?.day).toBe('2026-09-29'); expect(calls.at(-1)?.filters['day']).toBe('2026-09-29');
    });
});
