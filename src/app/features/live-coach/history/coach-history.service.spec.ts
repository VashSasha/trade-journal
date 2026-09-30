import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { LiveCoachFollowUpAnswer, LiveCoachObservation } from '../live-coach.models';
import { HISTORY_PAGE_SIZE, observationToHistory, SavedCoachObservation } from './coach-history.model';
import { CoachHistoryService } from './coach-history.service';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const answer: LiveCoachFollowUpAnswer = { meaning: 'Copied entry.', evidence: 'Five accounts.', nextStep: 'Review your plan.' };
const observation = (historyId = ID): LiveCoachObservation => ({
    id: 1, historyId, time: Date.parse('2026-09-18T15:00:00Z'), title: 'Position opened', text: 'Opened five contracts.', personalized: false,
    snapshot: {
        observation: { kind: 'opened', symbol: 'MNQ', direction: 'long', previousQuantity: 0, quantity: 5, accountCount: 5, averagePrice: 23000 },
        session: { tradeDate: '2026-09-18', dailyPnl: 200, weeklyPnl: 600, executionCount: 20, decisionCount: 4,
            accountCount: 5, winRate: 50, consecutiveLosses: 1, recentDecisionPnls: [300, -100], typicalContractsPerAccount: 1, currentContractsPerAccount: 1 },
    },
});
type Row = SavedCoachObservation & { user_id: string };
type Result = { data: unknown; error: unknown };
interface Call { operation: string; filters: Record<string, unknown>; body?: Record<string, unknown>; cursor?: string; limit?: number; }

function setup(rows: Row[] = []) {
    const userId = signal<string | null>('owner-a'), demo = signal(false);
    let controller = new AbortController();
    const calls: Call[] = [];
    let nextResult: Promise<Result> | null = null;
    let fail = '';
    const from = vi.fn((table: string) => {
        expect(table).toBe('live_coach_history');
        const call: Call = { operation: 'select', filters: {} };
        const execute = async (): Promise<Result> => {
            calls.push(structuredClone(call));
            if (nextResult) { const result = nextResult; nextResult = null; return result; }
            if (fail === call.operation) { fail = ''; return { data: null, error: new Error('offline') }; }
            const matches = (row: Row) => Object.entries(call.filters).every(([key, value]) => row[key as keyof Row] === value);
            if (call.operation === 'upsert') {
                const row = call.body as unknown as Row;
                if (!rows.some(r => r.id === row.id && r.user_id === row.user_id)) rows.push(structuredClone(row));
                return { data: null, error: null };
            }
            if (call.operation === 'update') {
                const row = rows.find(matches);
                if (row) Object.assign(row, structuredClone(call.body));
                return { data: row ? { id: row.id } : null, error: null };
            }
            if (call.operation === 'delete') {
                for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1);
                return { data: null, error: null };
            }
            let result = rows.filter(matches).sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.id.localeCompare(a.id));
            if (call.cursor) {
                const date = call.cursor.match(/^observed_at.lt.([^,]+)/)![1];
                const id = call.cursor.match(/id.lt.([^)]*)/)![1];
                result = result.filter(row => row.observed_at < date || (row.observed_at === date && row.id < id));
            }
            return { data: structuredClone(result.slice(0, call.limit)), error: null };
        };
        const query = {
            select: (_?: string) => query,
            upsert: (body: Record<string, unknown>, options: unknown) => {
                expect(options).toEqual({ onConflict: 'user_id,id', ignoreDuplicates: true });
                call.operation = 'upsert'; call.body = body; return query;
            },
            update: (body: Record<string, unknown>) => { call.operation = 'update'; call.body = body; return query; },
            delete: () => { call.operation = 'delete'; return query; },
            eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
            order: () => query,
            limit: (limit: number) => { call.limit = limit; return query; },
            or: (cursor: string) => { call.cursor = cursor; return query; },
            abortSignal: (_: AbortSignal) => query,
            maybeSingle: () => query,
            then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
        };
        return query;
    });
    const isCurrent = (scope: UserOperation) => !scope.signal.aborted && scope.userId === userId();
    TestBed.configureTestingModule({ providers: [
        { provide: SupabaseService, useValue: { client: { from } } },
        { provide: UserSessionService, useValue: { userId, isCurrent } },
        { provide: AccessPolicyService, useValue: { demo, capture: () => ({ userId: userId()!, signal: controller.signal }) } },
    ] });
    const service = TestBed.inject(CoachHistoryService); TestBed.tick();
    return { service, rows, calls, from, demo,
        fail: (operation: string) => { fail = operation; },
        hold: () => { let resolve!: (result: Result) => void; nextResult = new Promise(done => { resolve = done; }); return resolve; },
        switchUser: (id: string | null) => { controller.abort(); controller = new AbortController(); userId.set(id); TestBed.tick(); },
        settled: async () => { await vi.waitFor(() => expect(service.pendingCount()).toBe(0)); },
    };
}

afterEach(() => TestBed.resetTestingModule());

describe('saved Live Coach history', () => {
    it('waits for an in-flight observation save before allowing chat to reference it', async () => {
        const { service, hold, calls } = setup();
        const resolve = hold(); service.record(observation());
        let complete = false;
        const waiting = service.ensureSaved(ID).then(saved => { complete = true; return saved; });
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(complete).toBe(false);
        resolve({ data: null, error: null }); expect(await waiting).toBe(true);
        service.removed.set(new Set([ID])); expect(await service.ensureSaved(ID)).toBe(false);
    });
    it('does not attach another user’s observation when the user changes during saving', async () => {
        const { service, hold, switchUser, calls } = setup();
        const resolve = hold(); service.record(observation()); const waiting = service.ensureSaved(ID);
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        switchUser('other'); resolve({ data: null, error: null }); expect(await waiting).toBe(false);
    });
    it('saves captured text/context and reloads observations plus answers in a new browser session', async () => {
        const first = setup();
        const comment = observation();
        first.service.record(comment);
        first.service.saveAnswer(comment, 'explain', answer);
        first.service.saveAnswer(comment, 'compare-session', { ...answer, meaning: 'Four decisions, not twenty.' });
        comment.snapshot!.session.dailyPnl = 999;
        await first.settled();
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0].snapshot!.session.dailyPnl).toBe(200);
        const rows = first.rows; TestBed.resetTestingModule();
        const second = setup(rows);
        expect(second.from).not.toHaveBeenCalled();
        await second.service.load();
        expect(second.service.items()[0].explanation).toEqual(answer);
        expect(second.service.items()[0].session_comparison?.meaning).toContain('Four decisions');
        expect(second.calls.every(call => call.operation === 'select')).toBe(true);
    });

    it('retries with the same identity and does not duplicate or overwrite earlier answers', async () => {
        const { service, rows, fail, settled } = setup();
        fail('upsert'); service.record(observation());
        await vi.waitFor(() => expect(service.failedCount()).toBe(1));
        service.saveAnswer(observation(), 'explain', answer); await settled();
        service.record(observation()); await settled();
        expect(rows).toHaveLength(1); expect(rows[0].explanation).toEqual(answer);
        fail('update'); service.saveAnswer(observation(), 'compare-session', answer);
        await vi.waitFor(() => expect(service.failedCount()).toBe(1));
        service.retrySaves(); await settled();
        expect(rows[0].session_comparison).toEqual(answer);
    });

    it('paginates by time and UUID and filters by captured trading day', async () => {
        const rows = Array.from({ length: HISTORY_PAGE_SIZE + 2 }, (_, i) => ({ ...observationToHistory(observation()),
            id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, user_id: 'owner-a' }));
        const { service, calls } = setup(rows);
        await service.load('2026-09-18');
        expect(service.items()).toHaveLength(HISTORY_PAGE_SIZE); expect(service.hasMore()).toBe(true);
        await service.load(service.date(), true);
        expect(service.items()).toHaveLength(HISTORY_PAGE_SIZE + 2); expect(service.hasMore()).toBe(false);
        expect(calls[1].cursor).toContain('id.lt.');
        await service.load('2026-09-19'); expect(service.items()).toEqual([]);
    });

    it('clears history on owner change and ignores late results for the previous owner', async () => {
        const { service, hold, calls, switchUser } = setup();
        const resolve = hold(); const loading = service.load();
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        switchUser('owner-b');
        resolve({ data: [observationToHistory(observation())], error: null }); await loading;
        expect(service.items()).toEqual([]); expect(service.loading()).toBe(false);
        expect(calls[0].filters['user_id']).toBe('owner-a');
        await service.load(); expect(calls[1].filters['user_id']).toBe('owner-b');
    });

    it('does not read, save or delete real history in demo mode', async () => {
        const { service, from, demo } = setup(); demo.set(true); TestBed.tick();
        service.record(observation()); service.saveAnswer(observation(), 'explain', answer);
        await service.load(); await service.remove(ID); service.retrySaves();
        expect(from).not.toHaveBeenCalled();
    });

    it('waits for an in-flight save before deleting and never recreates it from a late follow-up', async () => {
        const { service, hold, calls, settled } = setup();
        const resolve = hold(); service.record(observation());
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        const removed = service.remove(ID);
        service.saveAnswer(observation(), 'explain', answer);
        expect(calls).toHaveLength(1);
        resolve({ data: null, error: null }); expect(await removed).toBe(true); await settled();
        service.record(observation()); service.retrySaves();
        expect(calls.map(call => call.operation)).toEqual(['upsert', 'delete']);
        expect(service.items()).toEqual([]);
    });

    it('retains the row and surfaces a failed delete, then permits retry', async () => {
        const { service, rows, fail, settled } = setup(); service.record(observation()); await settled(); await service.load();
        fail('delete'); expect(await service.remove(ID)).toBe(false);
        expect(service.items()).toHaveLength(1); expect(service.error()).toContain('Could not delete');
        expect(await service.remove(ID)).toBe(true); expect(rows).toEqual([]);
    });

    it('ignores a stale date-filter response and surfaces missing-migration/load failures', async () => {
        const { service, hold, calls, fail } = setup();
        const resolve = hold(); const previous = service.load('2026-09-17');
        await vi.waitFor(() => expect(calls).toHaveLength(1)); await service.load('2026-09-18');
        resolve({ data: [observationToHistory(observation())], error: null }); await previous;
        expect(service.items()).toEqual([]);
        fail('select'); await service.load(); expect(service.error()).toContain('Could not load');
        expect(service.loading()).toBe(false);
    });

    it('drops queued writes and errors on logout instead of saving them under a later login', async () => {
        const { service, fail, switchUser, calls } = setup(); fail('upsert'); service.record(observation());
        await vi.waitFor(() => expect(service.failedCount()).toBe(1));
        switchUser(null); switchUser('owner-b'); service.retrySaves();
        expect(service.failedCount()).toBe(0); expect(service.pendingCount()).toBe(0); expect(calls).toHaveLength(1);
    });

    it('does not include audio, account credentials or extra fields in persisted snapshots', () => {
        const comment = observation();
        Object.assign(comment, { audio: 'not for storage', provider_token: 'not for storage' });
        Object.assign(comment.snapshot!, { token: 'not for storage' });
        Object.assign(comment.snapshot!.observation, { connectionId: 'not for storage' });
        expect(JSON.stringify(observationToHistory(comment))).not.toContain('not for storage');
        const guardrail = { ...observation(), snapshot: undefined, time: new Date(2026, 8, 18, 18).getTime() };
        expect(observationToHistory(guardrail).trade_date).toBe('2026-09-19');
    });
});
