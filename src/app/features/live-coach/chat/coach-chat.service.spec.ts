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
    const from = vi.fn((table: string) => {
        const call: Call = { table, operation: 'select', filters: {} };
        const query = {
            select: () => query, order: () => query, limit: () => query, or: () => query, maybeSingle: () => query,
            eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
            upsert: (body: any, options: any) => { expect(options.ignoreDuplicates).toBe(true); call.body = body; call.operation = 'upsert'; return query; },
            delete: () => { call.operation = 'delete'; return query; }, abortSignal: () => query,
            then: (resolve: (result: any) => unknown, reject: (error: unknown) => unknown) => {
                calls.push(call);
                return Promise.resolve({ data: table === 'live_coach_ai_usage' ? { count: 4 } : rows, error: fail ? new Error('offline') : null }).then(resolve, reject);
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
    return { service, askCoach, ensureSaved, calls, from, demo, allowed, setRows: (value: any[]) => { rows = value; }, fail: () => { fail = true; },
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
        await service.initialize();
        expect(askCoach).not.toHaveBeenCalled();
        service.draft.set('Help me plan.'); await service.send();
        expect(askCoach).toHaveBeenCalledTimes(1);
        expect(askCoach.mock.calls[0][0].context).toMatchObject({ dataReady: false, summary: null, accountIds: ['a'] });
        expect(service.turns()[0].answer).toEqual(answer);
        expect(calls.find(c => c.operation === 'upsert')?.body.user_id).toBe('owner');
        expect(calls.some(c => c.table === 'coach_chat_turns' && c.operation !== 'select')).toBe(false);
        expect(service.allowance()?.remaining).toBe(26);
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
        await service.initialize(); await service.open('thread'); await service.send();
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
