import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Trade } from '../../core/models/trade.model';
import { FilterService, FilterState } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { setCacheSuspended } from '../../core/services/user-data/user-data.cache';
import { UserSessionService } from '../../core/services/user-session.service';
import { TradovateLiveAccountMetric } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { SessionAlertsService } from './session-alerts.service';
import { PerformanceAlertsService } from './performance-alerts.service';
import { AccountAlertPreferencesService } from './account-alert-preferences.service';
import { parsePerformanceAlertPreferences } from './performance-alerts.utils';

function closed(id: string, accountId: string, pnl: number): Trade {
    const date = '2026-08-04T14:00:00';
    return {
        id, userId: 'A', accountId, symbol: 'NQ', assetType: 'futures', direction: 'long',
        entryDate: date, exitDate: date, entryPrice: 1, exitPrice: 2, quantity: 1,
        netPnl: pnl, status: 'closed', createdAt: date, updatedAt: date,
    };
}

describe('performance alert coordinator', () => {
    const trades = signal<Trade[]>([]);
    const userId = signal<string | null>('A');
    const loaded = signal(true);
    const filters = signal<FilterState>({ dateRange: { start: null, end: null }, symbols: [], setups: [], sides: [], accountIds: [] });
    const liveMetrics = signal<TradovateLiveAccountMetric[]>([]);
    const setLiveRequested = vi.fn();
    const announce = vi.fn();
    const performancePreferences = signal(parsePerformanceAlertPreferences(null));
    const updatePerformance = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-04T14:30:00'));
        localStorage.clear(); setCacheSuspended(false);
        trades.set([]); userId.set('A'); loaded.set(true);
        liveMetrics.set([]); setLiveRequested.mockReset();
        performancePreferences.set(parsePerformanceAlertPreferences(null));
        updatePerformance.mockReset();
        updatePerformance.mockImplementation(updater => performancePreferences.set(updater(performancePreferences())));
        filters.set({ dateRange: { start: null, end: null }, symbols: [], setups: [], sides: [], accountIds: [] });
        announce.mockReset();
        TestBed.configureTestingModule({ providers: [
            { provide: TradeService, useValue: { trades } },
            { provide: FilterService, useValue: { filters } },
            { provide: UserDataService, useValue: { dataLoaded: loaded } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: SessionAlertsService, useValue: { announce } },
            { provide: TradovateLiveService, useValue: { metrics: liveMetrics, setRequested: setLiveRequested } },
            { provide: AccountAlertPreferencesService, useValue: {
                performance: performancePreferences,
                loading: signal(false), syncWarning: signal(false), storageWarning: signal(false),
                updatePerformance,
            } },
        ] });
    });

    afterEach(() => {
        TestBed.resetTestingModule(); setCacheSuspended(false); vi.useRealTimers();
    });

    it('alerts once when fresh synced data crosses a configured threshold', () => {
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setValue('dailyProfit', 500); service.setEnabled('dailyProfit', true); TestBed.tick();
        trades.set([closed('1', '10', 600)]); TestBed.tick();
        expect(service.event()).toMatchObject({ tone: 'target', text: expect.stringContaining('Daily profit target') });
        expect(announce).toHaveBeenCalledExactlyOnceWith('target', expect.stringContaining('$600'));

        trades.set([closed('1', '10', 600), closed('2', '10', -50)]); TestBed.tick();
        trades.set([closed('1', '10', 600), closed('2', '10', -50), closed('3', '10', 100)]); TestBed.tick();
        expect(announce).toHaveBeenCalledOnce();
    });

    it('baselines loaded history and account-selection changes instead of replaying alerts', () => {
        trades.set([closed('1', '10', 600)]);
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setValue('dailyProfit', 500); service.setEnabled('dailyProfit', true); TestBed.tick();
        expect(service.event()).toBeNull();

        filters.set({ ...filters(), accountIds: ['20'], accountSelectionActive: true }); TestBed.tick();
        trades.update(items => [...items, closed('2', '10', 900)]); TestBed.tick();
        expect(service.event()).toBeNull();
        trades.update(items => [...items, closed('3', '20', 550)]); TestBed.tick();
        expect(service.event()?.text).toContain('Daily profit target');
    });

    it('sends preference edits through the account-synced store', () => {
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setEnabled('dailyLoss', true);
        expect(updatePerformance).toHaveBeenCalledOnce();
        expect(service.preferences().dailyLoss.enabled).toBe(true);
    });

    it('baselines the initial broker snapshot, then alerts on a live P&L crossing', () => {
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setValue('dailyProfit', 500); service.setEnabled('dailyProfit', true); TestBed.tick();
        expect(setLiveRequested).toHaveBeenLastCalledWith('performance-alerts', true);

        liveMetrics.set([{
            connectionId: 'c1', accountId: 10, tradeDate: '2026-08-04',
            dailyPnl: 400, weeklyPnl: 400, balance: 50_400, completedTrades: 0,
            baselineKey: 'c1:10:1:2026-08-04', updatedAt: 1,
        }]);
        TestBed.tick();
        expect(service.event()).toBeNull();

        liveMetrics.update(([metric]) => [{ ...metric, dailyPnl: 600, weeklyPnl: 600, updatedAt: 2 }]);
        TestBed.tick();
        expect(service.event()).toMatchObject({ tone: 'target', text: expect.stringContaining('$600') });
    });

    it('does not double-count a live completion when the saved trade catches up', () => {
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setValue('dailyTrades', 2); service.setEnabled('dailyTrades', true); TestBed.tick();
        liveMetrics.set([{
            connectionId: 'c1', accountId: 10, tradeDate: '2026-08-04',
            dailyPnl: 0, weeklyPnl: 0, balance: 50_000, completedTrades: 0,
            baselineKey: 'c1:10:1:2026-08-04', updatedAt: 1,
        }]);
        TestBed.tick();

        liveMetrics.update(([metric]) => [{ ...metric, completedTrades: 1, updatedAt: 2 }]);
        TestBed.tick();
        trades.set([closed('1', '10', 20)]); TestBed.tick();
        expect(service.event()).toBeNull();

        liveMetrics.update(([metric]) => [{ ...metric, completedTrades: 2, updatedAt: 3 }]);
        TestBed.tick();
        expect(service.event()?.text).toContain('2 completed trades');
        trades.set([closed('1', '10', 20), closed('2', '10', 30)]); TestBed.tick();
        expect(announce).toHaveBeenCalledOnce();
    });
});
