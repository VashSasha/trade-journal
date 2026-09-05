import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Trade } from '../../core/models/trade.model';
import { FilterService, FilterState } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { setCacheSuspended } from '../../core/services/user-data/user-data.cache';
import { UserSessionService } from '../../core/services/user-session.service';
import { SessionAlertsService } from './session-alerts.service';
import { PerformanceAlertsService } from './performance-alerts.service';

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
    const announce = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-04T14:30:00'));
        localStorage.clear(); setCacheSuspended(false);
        trades.set([]); userId.set('A'); loaded.set(true);
        filters.set({ dateRange: { start: null, end: null }, symbols: [], setups: [], sides: [], accountIds: [] });
        announce.mockReset();
        TestBed.configureTestingModule({ providers: [
            { provide: TradeService, useValue: { trades } },
            { provide: FilterService, useValue: { filters } },
            { provide: UserDataService, useValue: { dataLoaded: loaded } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: SessionAlertsService, useValue: { announce } },
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

    it('keeps browser preferences separated by signed-in owner', () => {
        const service = TestBed.inject(PerformanceAlertsService); TestBed.tick();
        service.setEnabled('dailyLoss', true);
        expect(localStorage.getItem('nvzn_performance_alert_preferences_v1:A')).toContain('"enabled":true');

        userId.set('B'); TestBed.tick();
        expect(service.preferences().dailyLoss.enabled).toBe(false);
    });
});
