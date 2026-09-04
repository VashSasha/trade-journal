import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { SyncService } from './sync.service';
import { TradovateService } from './tradovate.service';
import { TradeService } from './trade.service';
import { AccountSettingsService } from './account-settings.service';
import { UserSessionService } from './user-session.service';
import { SupabaseService } from './supabase.service';
import { UserDataRepo } from './user-data/user-data.repo';

describe('broker sync user isolation', () => {
    it('never imports A’s late broker response into B’s journal', async () => {
        let onAuth: (_event: string, session: unknown) => void = () => undefined;
        const client = { auth: {
            onAuthStateChange: (cb: typeof onAuth) => { onAuth = cb; },
            getSession: async () => ({ data: { session: { user: { id: 'A' } } } })
        } };
        const session = runInInjectionContext(Injector.create({ providers: [
            { provide: SupabaseService, useValue: { client } }
        ] }), () => new UserSessionService());
        await session.ready;
        const response = new Subject<any[]>();
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const createTrade = vi.fn();
        const broker = {
            connections: () => [{ id: 'connection-A', name: 'A', accounts: [] }],
            ensureFreshToken: async () => undefined,
            getAllTrades: () => { started(); return response; }
        };
        TestBed.configureTestingModule({ providers: [
            { provide: TradovateService, useValue: broker },
            { provide: UserSessionService, useValue: session },
            { provide: TradeService, useValue: { createTrade, backfillConnectionIds: () => 0 } },
            { provide: AccountSettingsService, useValue: {} },
            { provide: UserDataRepo, useValue: {} }
        ] });
        const sync = TestBed.runInInjectionContext(() => new SyncService());
        const pending = sync.syncFrom(null);
        const rejected = expect(pending).rejects.toBeTruthy();
        await ready;
        onAuth('SIGNED_IN', { user: { id: 'B' } });
        response.next([{ externalId: 'trade-A' }]);
        await rejected;
        expect(createTrade).not.toHaveBeenCalled();
        expect(sync.isSyncing()).toBe(false);
    });
});
