import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Trade } from '../../core/models/trade.model';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import { parseOnboardingProgress } from './onboarding.model';
import { OnboardingService } from './onboarding.service';

type Result = { data: unknown; error: unknown };
function setup(saved: Record<string, unknown> = {}) {
    const userId = signal<string | null>('owner-a'), demo = signal(false);
    const trades = signal<Trade[]>([]), dataLoaded = signal(true);
    let controller = new AbortController();
    const rows: Record<string, Record<string, unknown>> = { 'owner-a': saved };
    let pendingRead: Promise<Result> | null = null, pendingWrite: Promise<Result> | null = null;
    const from = vi.fn((table: string) => {
        expect(table).toBe('user_settings');
        let owner = '';
        const query = {
            select: (columns: string) => { expect(columns).toBe('prefs'); return query; },
            eq: (key: string, value: string) => { expect(key).toBe('user_id'); owner = value; return query; },
            abortSignal: () => query,
            maybeSingle: () => {
                const result = pendingRead; pendingRead = null;
                return result ?? Promise.resolve({ data: { prefs: { onboarding: rows[owner] } }, error: null });
            },
        };
        return query;
    });
    const rpc = vi.fn((name: string, args: { p_patch: Record<string, unknown> }) => {
        expect(name).toBe('set_my_onboarding_progress');
        const owner = userId()!;
        return { abortSignal: () => {
            const result = pendingWrite; pendingWrite = null;
            if (result) return result;
            rows[owner] = { ...rows[owner], ...args.p_patch };
            return Promise.resolve({ data: rows[owner], error: null });
        } };
    });
    const isCurrent = (scope: UserOperation) => !scope.signal.aborted && userId() === scope.userId;
    TestBed.configureTestingModule({ providers: [
        { provide: SupabaseService, useValue: { client: { from, rpc } } },
        { provide: UserSessionService, useValue: { userId } },
        { provide: TradeService, useValue: { trades } },
        { provide: UserDataService, useValue: { dataLoaded } },
        { provide: AccessPolicyService, useValue: {
            demo, isCurrent, capture: () => ({ userId: userId()!, signal: controller.signal }),
            canAct: () => !!userId() && !demo(),
        } },
    ] });
    const service = TestBed.inject(OnboardingService);
    const changeWorkspace = () => { controller.abort(); controller = new AbortController(); };
    const settle = async () => {
        TestBed.tick();
        await vi.waitFor(() => expect(service.loading()).toBe(false));
    };
    return { service, rows, from, rpc, trades, dataLoaded, settle,
        switchUser: (owner: string | null) => { changeWorkspace(); userId.set(owner); TestBed.tick(); },
        setDemo: (value: boolean) => { changeWorkspace(); demo.set(value); TestBed.tick(); },
        hold: (kind: 'read' | 'write') => {
            let resolve!: (result: Result) => void;
            const promise = new Promise<Result>(done => { resolve = done; });
            if (kind === 'read') pendingRead = promise; else pendingWrite = promise;
            return resolve;
        },
    };
}

afterEach(() => TestBed.resetTestingModule());

describe('setup progress', () => {
    it('validates stored flags without accepting truthy strings or unrelated properties', () => {
        expect(parseOnboardingProgress(null)).toEqual({ started: false, dismissed: false, accountsReviewed: false, alertsReviewed: false, templatesReviewed: false, journalReviewed: false });
        expect(parseOnboardingProgress({ started: true, dismissed: 'false', alertsReviewed: 1, accountsReviewed: true, enabled: true }))
            .toEqual({ started: true, dismissed: false, accountsReviewed: true, alertsReviewed: false, templatesReviewed: false, journalReviewed: false });
    });

    it('waits for cloud data, invites a new owner, and never writes on initial load', async () => {
        const h = setup(); h.dataLoaded.set(false); await h.settle();
        expect(h.service.showInvitation()).toBe(false);
        h.dataLoaded.set(true); expect(h.service.showInvitation()).toBe(true);
        expect(h.from).toHaveBeenCalledOnce(); expect(h.rpc).not.toHaveBeenCalled();
    });

    it('does not show onboarding to established users or count foreign trades', async () => {
        const h = setup(); await h.settle();
        h.trades.set([{ userId: 'other' } as Trade]); expect(h.service.hasTrades()).toBe(false);
        h.trades.set([{ userId: 'owner-a' } as Trade]); expect(h.service.hasTrades()).toBe(true);
        expect(h.service.showInvitation()).toBe(false);
        await h.service.update({ started: true }); expect(h.service.showInvitation()).toBe(true);
    });

    it('restores dismissal and review progress in a new browser session', async () => {
        const first = setup(); await first.settle();
        await first.service.update({ started: true, dismissed: true, accountsReviewed: true });
        const saved = first.rows['owner-a']; TestBed.resetTestingModule();
        const second = setup(saved); await second.settle();
        expect(second.service.progress().accountsReviewed).toBe(true);
        expect(second.service.showInvitation()).toBe(false);
        await second.service.update({ dismissed: false }); expect(second.service.showInvitation()).toBe(true);
    });

    it('supports four explicit reviews without requiring new trades or changing alerts', async () => {
        const h = setup(); await h.settle();
        await h.service.update({ started: true, accountsReviewed: true, alertsReviewed: true });
        expect(h.service.complete()).toBe(false);
        h.trades.set([{ userId: 'owner-a' } as Trade]);
        expect(h.service.complete()).toBe(false);
        expect(h.rpc).toHaveBeenCalledExactlyOnceWith('set_my_onboarding_progress', {
            p_patch: { started: true, accountsReviewed: true, alertsReviewed: true },
        });
        await h.service.update({ templatesReviewed: true, journalReviewed: true });
        h.trades.set([]);
        expect(h.service.completedCount()).toBe(4); expect(h.service.complete()).toBe(true);
        expect(h.service.showInvitation()).toBe(false);
    });

    it('does not persist demo progress or flash it after returning to real data', async () => {
        const h = setup({ accountsReviewed: true }); await h.settle();
        h.setDemo(true); await h.service.update({ dismissed: true });
        expect(h.service.showInvitation()).toBe(false); expect(h.rpc).not.toHaveBeenCalled();
        h.setDemo(false); await h.settle(); expect(h.service.progress().accountsReviewed).toBe(true);
    });

    it('suppresses duplicate reads and writes while in flight', async () => {
        const h = setup(); const read = h.hold('read'); TestBed.tick();
        await h.service.load(); expect(h.from).toHaveBeenCalledOnce();
        read({ data: null, error: null }); await h.settle();
        const write = h.hold('write'); const saving = h.service.update({ started: true });
        await h.service.update({ started: true }); expect(h.rpc).toHaveBeenCalledOnce();
        write({ data: { started: true }, error: null }); await saving;
        expect(h.service.saving()).toBe(false);
    });

    it('does not apply late reads or saves to a different user', async () => {
        const h = setup(); const resolveRead = h.hold('read'); TestBed.tick();
        h.switchUser('owner-b'); await h.settle();
        resolveRead({ data: { prefs: { onboarding: { dismissed: true } } }, error: null });
        await Promise.resolve(); expect(h.service.progress().dismissed).toBe(false);
        const resolveWrite = h.hold('write'); const saving = h.service.update({ accountsReviewed: true });
        h.switchUser('owner-c'); await h.settle();
        resolveWrite({ data: { accountsReviewed: true }, error: null }); await saving;
        expect(h.service.progress().accountsReviewed).toBe(false);
        h.switchUser(null); expect(h.service.ready()).toBe(false); expect(h.service.showInvitation()).toBe(false);
    });

    it('shows read errors without inventing progress, and can retry', async () => {
        const h = setup(); const fail = h.hold('read'); TestBed.tick();
        fail({ data: null, error: new Error('offline') }); await h.settle();
        expect(h.service.error()).toContain('Couldn’t load'); expect(h.service.ready()).toBe(false);
        await h.service.load(); expect(h.service.ready()).toBe(true); expect(h.service.error()).toBeNull();
    });

    it('keeps previously saved values after a failed write and allows retry', async () => {
        const h = setup(); await h.settle(); const fail = h.hold('write');
        const saving = h.service.update({ dismissed: true });
        fail({ data: null, error: new Error('missing RPC') }); await saving;
        expect(h.service.progress().dismissed).toBe(false); expect(h.service.error()).toContain('weren’t saved');
        await h.service.update({ dismissed: true }); expect(h.service.progress().dismissed).toBe(true);
        expect(h.service.error()).toBeNull();
    });

    it('offers the popup once, saves dismissal and allows manual reopening without repeat writes', async () => {
        const h = setup(); await h.settle();
        expect(h.service.shouldOfferGuide()).toBe(true);
        h.service.openGuide(); expect(h.service.dialogOpen()).toBe(true);
        expect(h.service.shouldOfferGuide()).toBe(false); expect(h.rpc).not.toHaveBeenCalled();
        h.service.closeGuide(); await vi.waitFor(() => expect(h.service.saving()).toBe(false));
        expect(h.service.progress().dismissed).toBe(true);
        h.service.openGuide(); expect(h.service.dialogOpen()).toBe(true);
        h.switchUser(null); expect(h.service.dialogOpen()).toBe(false);
    });

    it('waits for loaded data and does not interrupt existing users, dismissed users or demo', async () => {
        const h = setup(); h.dataLoaded.set(false); await h.settle();
        expect(h.service.shouldOfferGuide()).toBe(false);
        h.trades.set([{ userId: 'owner-a' } as Trade]); h.dataLoaded.set(true);
        expect(h.service.shouldOfferGuide()).toBe(false);
        h.trades.set([]); await h.service.update({ started: true });
        expect(h.service.shouldOfferGuide()).toBe(false);
        h.setDemo(true); h.service.openGuide(); expect(h.service.dialogOpen()).toBe(false);
    });

    it('queues dismissal behind a pending review save instead of losing it', async () => {
        const h = setup(); await h.settle(); h.service.openGuide();
        const resolve = h.hold('write'); const save = h.service.update({ templatesReviewed: true });
        h.service.closeGuide(); expect(h.service.dialogOpen()).toBe(false);
        resolve({ data: { templatesReviewed: true }, error: null }); await save;
        await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
        expect(h.service.progress().dismissed).toBe(true);
    });
});
