import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import { AccountAlertPreferencesService } from './account-alert-preferences.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PERFORMANCE_KEY = 'nvzn_performance_alert_preferences_v1:';
const MARKET_KEY = 'nvzn_market_event_alerts_v1:';
const COACH_KEY = 'nvzn_live_coach_preferences_v1:';
const PENDING_KEY = 'nvzn_account_alert_preferences_pending_v1:';

describe('account-synced alert preferences', () => {
    function setup(cloudByOwner: Record<string, Record<string, unknown>> = { [A]: {} }, saveError: unknown = null) {
        const userId = signal<string | null>(A);
        const controller = new AbortController();
        let currentSaveError = saveError;
        const from = vi.fn(() => {
            let selectedOwner = '';
            const query: any = {
                select: () => query,
                eq: (_key: string, value: string) => { selectedOwner = value; return query; },
                abortSignal: () => query,
                maybeSingle: async () => ({
                    data: { prefs: cloudByOwner[selectedOwner] ?? {} },
                    error: null,
                }),
            };
            return query;
        });
        const rpcResult = vi.fn(async () => ({ data: null, error: currentSaveError }));
        const rpc = vi.fn((_name: string, _args: unknown) => ({ abortSignal: rpcResult }));
        const session = {
            userId,
            capture: (): UserOperation => {
                const owner = userId();
                if (!owner) throw new Error('not signed in');
                return { userId: owner, signal: controller.signal };
            },
            assertCurrent: (operation: UserOperation) => {
                if (operation.signal.aborted || operation.userId !== userId()) throw new Error('session changed');
            },
            isCurrent: (operation: UserOperation) =>
                !operation.signal.aborted && operation.userId === userId(),
        };
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client: { from, rpc } } },
            { provide: UserSessionService, useValue: session },
        ] });
        const service = TestBed.inject(AccountAlertPreferencesService);
        TestBed.tick();
        return { service, userId, rpc, rpcResult, setSaveError: (error: unknown) => { currentSaveError = error; } };
    }

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('loads portable guardrails and event choices in a fresh browser', async () => {
        const performance = {
            dailyProfit: { enabled: true, value: 600 }, dailyLoss: { enabled: true, value: 250 },
            weeklyProfit: { enabled: false, value: 2000 }, weeklyLoss: { enabled: false, value: 900 },
            dailyTrades: { enabled: true, value: 8 },
        };
        const market = { enabled: true, leadMinutes: 30, highOnly: false };
        const coach = {
            enabled: true, aiCommentary: true, entries: true, sizing: false, exits: true, guardrails: true,
            cooldownSeconds: 20, speechRate: 1.2, voice: 'browser',
        };
        const { service, rpc } = setup({ [A]: {
            performance_alerts: performance,
            market_event_alerts: market,
            live_coach: coach,
        } });

        await vi.waitFor(() => expect(service.loading()).toBe(false));

        expect(service.performance()).toEqual(performance);
        expect(service.marketEvents()).toEqual({ ...market, desktopNotifications: false });
        expect(service.liveCoach()).toEqual(coach);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('migrates existing browser settings without uploading desktop permission', async () => {
        localStorage.setItem(PERFORMANCE_KEY + A, JSON.stringify({
            dailyProfit: { enabled: true, value: 700 },
        }));
        localStorage.setItem(MARKET_KEY + A, JSON.stringify({
            enabled: true, leadMinutes: 10, highOnly: true, desktopNotifications: true,
        }));
        const { service, rpc } = setup();

        await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(service.syncWarning()).toBe(false));

        expect(rpc).toHaveBeenCalledWith('set_my_account_alert_preferences', expect.objectContaining({
            p_kind: 'performance_alerts',
        }));
        expect(rpc).toHaveBeenCalledWith('set_my_account_alert_preferences', {
            p_kind: 'market_event_alerts',
            p_preferences: { enabled: true, leadMinutes: 10, highOnly: true },
        });
        expect(localStorage.getItem(`${PENDING_KEY}${A}:performance`)).toBeNull();
        expect(localStorage.getItem(`${PENDING_KEY}${A}:market`)).toBeNull();
    });

    it('defaults a fresh account to Cedar without automatically enabling coaching', async () => {
        const { service, rpc } = setup();
        await vi.waitFor(() => expect(service.loading()).toBe(false));
        expect(service.liveCoach()).toEqual(expect.objectContaining({
            voice: 'cedar', enabled: false, aiCommentary: false,
        }));
        expect(rpc).not.toHaveBeenCalled();
    });

    it('loads an additional saved AI voice in a fresh browser and preserves it on edits', async () => {
        const { service, rpc } = setup({ [A]: { live_coach: { voice: 'coral' } } });
        await vi.waitFor(() => expect(service.loading()).toBe(false));
        expect(service.liveCoach().voice).toBe('coral');
        service.updateLiveCoach(current => ({ ...current, speechRate: 1.2 }));
        await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
        expect(rpc).toHaveBeenCalledWith('set_my_account_alert_preferences', {
            p_kind: 'live_coach', p_preferences: expect.objectContaining({ voice: 'coral', speechRate: 1.2 }),
        });
    });

    it('syncs account edits but keeps desktop-notification opt-in on this browser', async () => {
        const { service, rpc } = setup({ [A]: {
            performance_alerts: {
                dailyProfit: { enabled: false, value: 500 }, dailyLoss: { enabled: false, value: 300 },
                weeklyProfit: { enabled: false, value: 1500 }, weeklyLoss: { enabled: false, value: 750 },
                dailyTrades: { enabled: false, value: 10 },
            },
            market_event_alerts: { enabled: false, leadMinutes: 15, highOnly: true },
        } });
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        service.updateMarketDevice(current => ({ ...current, desktopNotifications: true }));
        expect(rpc).not.toHaveBeenCalled();
        service.updateMarketAccount(current => ({ ...current, enabled: true }));
        await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());

        expect(rpc).toHaveBeenCalledWith('set_my_account_alert_preferences', {
            p_kind: 'market_event_alerts',
            p_preferences: { enabled: true, leadMinutes: 15, highOnly: true },
        });
        expect(service.marketEvents().desktopNotifications).toBe(true);
    });

    it('syncs portable Live Coach controls through the validated alert RPC', async () => {
        const { service, rpc } = setup({ [A]: {
            live_coach: {
                enabled: false, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
                cooldownSeconds: 10, speechRate: 1, voice: 'browser',
            },
        } });
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        service.updateLiveCoach(current => ({ ...current, enabled: true, cooldownSeconds: 20 }));
        await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());

        expect(rpc).toHaveBeenCalledWith('set_my_account_alert_preferences', {
            p_kind: 'live_coach',
            p_preferences: {
                enabled: true, aiCommentary: false, entries: true, sizing: true, exits: true, guardrails: true,
                cooldownSeconds: 20, speechRate: 1, voice: 'browser',
            },
        });
        expect(localStorage.getItem(COACH_KEY + A)).not.toBeNull();
        expect(localStorage.getItem(`${PENDING_KEY}${A}:coach`)).toBeNull();
    });

    it('does not leak one account settings into the next signed-in account', async () => {
        const { service, userId } = setup({
            [A]: { market_event_alerts: { enabled: true, leadMinutes: 5, highOnly: false } },
            [B]: {},
        });
        await vi.waitFor(() => expect(service.loading()).toBe(false));
        expect(service.marketEvents().enabled).toBe(true);

        userId.set(B);
        TestBed.tick();
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        expect(service.marketEvents().enabled).toBe(false);
        expect(service.performance().dailyProfit.enabled).toBe(false);
        expect(service.liveCoach().enabled).toBe(false);
    });

    it('retains pending browser settings when cloud sync fails', async () => {
        const { service, rpcResult, setSaveError } = setup({ [A]: {} }, { message: 'offline' });
        await vi.waitFor(() => expect(service.loading()).toBe(false));

        service.updatePerformance(current => ({
            ...current,
            dailyLoss: { ...current.dailyLoss, enabled: true },
        }));
        await vi.waitFor(() => expect(rpcResult).toHaveBeenCalled());
        await vi.waitFor(() => expect(service.syncWarning()).toBe(true));

        expect(service.performance().dailyLoss.enabled).toBe(true);
        expect(localStorage.getItem(`${PENDING_KEY}${A}:performance`)).toBe('1');

        setSaveError(null);
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(rpcResult).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(service.syncWarning()).toBe(false));
        expect(localStorage.getItem(`${PENDING_KEY}${A}:performance`)).toBeNull();
    });
});
