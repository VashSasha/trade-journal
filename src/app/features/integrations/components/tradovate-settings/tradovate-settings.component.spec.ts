import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { TradovateSettingsComponent } from './tradovate-settings.component';
import { TradovateService } from '../../../../core/services/tradovate.service';
import { SyncService } from '../../../../core/services/sync.service';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { TradeService } from '../../../../core/services/trade.service';
import { DemoModeService } from '../../../../core/services/demo-mode.service';
import { UserSessionService } from '../../../../core/services/user-session.service';

describe('connect then import', () => {
    it('waits for account discovery and ignores duplicate connect clicks', async () => {
        const accounts = new Subject<any[]>();
        const fullSync = vi.fn(async () => 3);
        const simpleLogin = vi.fn(() => of({ connectionId: 'connection' }));
        TestBed.configureTestingModule({ providers: [FormBuilder,
            { provide: Router, useValue: {} },
            { provide: DemoModeService, useValue: { requireAccount: () => true } },
            { provide: TradovateService, useValue: { simpleLogin, connections: () => [{ id: 'connection' }], getAccountsForConnection: () => accounts } },
            { provide: SyncService, useValue: { fullSync } },
            { provide: AccountSettingsService, useValue: {} },
            { provide: TradeService, useValue: {} },
            { provide: UserSessionService, useValue: { capture: () => ({}), assertCurrent: () => {}, isCurrent: () => true } },
        ] });
        const component = TestBed.runInInjectionContext(() => new TradovateSettingsComponent());
        component.configForm.patchValue({ connectionName: 'Broker', username: 'user', password: 'test' });
        const connecting = component.connect();
        await Promise.resolve();
        await component.connect();
        expect(simpleLogin).toHaveBeenCalledOnce();
        expect(fullSync).not.toHaveBeenCalled();
        expect(component.isConnecting()).toBe(true);
        accounts.next([{ id: 1 }]);
        await connecting;
        expect(fullSync).toHaveBeenCalledOnce();
        expect(component.isConnecting()).toBe(false);
        expect(component.configForm.value.password).toBe('');
    });
});
