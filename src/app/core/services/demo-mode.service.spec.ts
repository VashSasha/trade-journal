import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { DemoModeService } from './demo-mode.service';
import { AuthService } from './auth.service';
import { UserSessionService } from './user-session.service';
import { TradeService } from './trade.service';
import { DailyJournalService } from './daily-journal.service';
import { AccountSettingsService } from './account-settings.service';
import { TradingAccountsService } from './trading-accounts.service';
import { AccountService } from './account.service';
import { UserDataService } from './user-data/user-data.service';
import { CACHE_KEYS, setCacheSuspended } from './user-data/user-data.cache';

describe('safe demo transitions', () => {
    beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setCacheSuspended(false); });
    afterEach(() => setCacheSuspended(false));
    function setup(plan = 'free', owner = 'A', url = '/reports') {
        localStorage.setItem(CACHE_KEYS.owner, JSON.stringify(owner));
        localStorage.setItem(CACHE_KEYS.trades, JSON.stringify([{ id: 'real-trade' }]));
        const trades = { hydrate: vi.fn() };
        const reload = vi.fn(async () => {});
        let arrived!: (value: boolean) => void;
        const navigateByUrl = vi.fn((_url: string, _extras?: unknown) => new Promise<boolean>(resolve => { arrived = resolve; }));
        TestBed.configureTestingModule({ providers: [
            { provide: Router, useValue: { navigateByUrl, url } },
            { provide: AuthService, useValue: { currentUser: () => ({ id: 'A' }), isAuthenticated: () => true, plan: () => plan } },
            { provide: UserSessionService, useValue: {} },
            { provide: TradeService, useValue: trades },
            { provide: DailyJournalService, useValue: { hydrateNotes: vi.fn(), hydrateRules: vi.fn(), hydrateTemplates: vi.fn() } },
            { provide: AccountSettingsService, useValue: { hydrate: vi.fn() } },
            { provide: TradingAccountsService, useValue: { hydrate: vi.fn() } },
            { provide: AccountService, useValue: { setDemoLiveAccount: vi.fn(), setSelectionTransient: vi.fn(), resetLiveAccounts: vi.fn(), restorePersistedSelection: vi.fn() } },
            { provide: UserDataService, useValue: { reload } },
        ] });
        return { demo: TestBed.inject(DemoModeService), trades, reload, navigateByUrl, arrive: (ok = true) => arrived(ok) };
    }
    it('does not replace a free user’s empty workspace with demo automatically', () => {
        const { demo, trades } = setup();
        TestBed.tick();
        expect(demo.active()).toBe(false);
        expect(trades.hydrate).not.toHaveBeenCalled();
    });
    it('leaves the paid preview route before exposing cached real trades', async () => {
        const { demo, trades, arrive, navigateByUrl, reload } = setup();
        demo.enter(); trades.hydrate.mockClear();
        const pending = demo.exit('/account/integrations');
        expect(demo.transitioning()).toBe(true);
        expect(demo.active()).toBe(true);
        expect(trades.hydrate).not.toHaveBeenCalled();
        expect(navigateByUrl).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
        arrive(); await pending;
        expect(trades.hydrate).toHaveBeenCalledWith([{ id: 'real-trade' }]);
        expect(demo.active()).toBe(false);
        expect(reload).toHaveBeenCalledOnce();
        expect(navigateByUrl).toHaveBeenCalledOnce(); // Free must not reach broker settings.
        expect(JSON.parse(localStorage.getItem(CACHE_KEYS.trades)!)).toEqual([{ id: 'real-trade' }]);
    });
    it('keeps demo active if safe navigation is cancelled', async () => {
        const { demo, trades, arrive } = setup();
        demo.enter(); trades.hydrate.mockClear();
        const pending = demo.exit(); arrive(false); await pending;
        expect(demo.active()).toBe(true);
        expect(trades.hydrate).not.toHaveBeenCalled();
    });
    it.each(['/dashboard', '/dashboard?range=today#stats'])('exits demo when already on %s', async url => {
        const { demo, trades, reload, navigateByUrl } = setup('free', 'A', url);
        demo.enter(); trades.hydrate.mockClear();
        await demo.exit();
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(demo.active()).toBe(false);
        expect(demo.transitioning()).toBe(false);
        expect(trades.hydrate).toHaveBeenCalledWith([{ id: 'real-trade' }]);
        expect(reload).toHaveBeenCalledOnce();
        expect(sessionStorage.getItem('demo_mode_active')).toBeNull();
    });
    it('never restores another user’s cached trades after a login inside demo', async () => {
        const { demo, trades, arrive } = setup('free', 'other-user');
        demo.enter(); trades.hydrate.mockClear();
        const pending = demo.exit(); arrive(); await pending;
        expect(trades.hydrate).toHaveBeenCalledWith([]);
        expect(trades.hydrate).not.toHaveBeenCalledWith([{ id: 'real-trade' }]);
    });
    it('lets paid users connect only after leaving demo', async () => {
        const { demo, navigateByUrl, arrive } = setup('premium');
        demo.enter(); const pending = demo.exit('/account/integrations');
        arrive(); await Promise.resolve();
        expect(demo.active()).toBe(false);
        expect(navigateByUrl).toHaveBeenLastCalledWith('/account/integrations');
        arrive(); await pending;
        expect(demo.transitioning()).toBe(false);
    });
});
