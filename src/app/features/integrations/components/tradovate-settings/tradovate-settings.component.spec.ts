import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
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
import { BrokerSyncStatusComponent } from '../../sync-status/broker-sync-status.component';

@Component({ selector: 'app-broker-sync-status', standalone: true, template: '' })
class SyncStatusStub {}

describe('broker connections layout', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('opens the broker picker, then the provider form, above existing connections', async () => {
        TestBed.configureTestingModule({ providers: [
            { provide: Router, useValue: {} },
            { provide: DemoModeService, useValue: {} },
            { provide: TradovateService, useValue: { settingsConnections: signal([
                { id: 'broker', name: 'Existing broker', config: { environment: 'demo' }, accounts: [] },
            ]) } },
            { provide: SyncService, useValue: {
                isSyncing: signal(false), syncLog: signal([]), syncProgress: signal(null),
                lastError: signal(null), syncWarning: signal(null), lastResult: signal(null),
            } },
            { provide: AccountSettingsService, useValue: { commissionPerContract: signal(0.25) } },
            { provide: TradeService, useValue: {} },
            { provide: UserSessionService, useValue: {} },
        ] });
        TestBed.overrideComponent(TradovateSettingsComponent, {
            remove: { imports: [BrokerSyncStatusComponent] }, add: { imports: [SyncStatusStub] },
        });
        const fixture = TestBed.createComponent(TradovateSettingsComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const connections = root.querySelector('.tv-settings__section')!;
        const add = root.querySelector<HTMLButtonElement>('.tv-settings__add-btn')!;
        expect(add.closest('.tv-settings__header')).not.toBeNull();
        expect(add.textContent?.trim()).toBe('Add connection');
        expect(add.querySelector('p')).toBeNull();
        expect(add.compareDocumentPosition(connections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        add.click(); fixture.detectChanges();
        const picker = root.querySelector('app-broker-picker')!;
        expect(picker.compareDocumentPosition(connections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(root.querySelector('form')).toBeNull();
        root.querySelector<HTMLButtonElement>('.broker-picker__broker')!.click(); fixture.detectChanges();
        const form = root.querySelector('form')!;
        expect(form.compareDocumentPosition(connections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await fixture.whenStable();
        expect(document.activeElement).toBe(root.querySelector('.tv-settings__form-title'));
        expect(root.querySelector('.tv-settings__provider img')?.getAttribute('src')).toBe('/brokers/tradovate-icon.png');
        expect(root.querySelector('.tv-settings__conn-name')?.textContent).toContain('Existing broker');

        fixture.componentInstance.configForm.patchValue({ username: 'private-user', password: 'temporary-secret' });
        fixture.componentInstance.showSecret.set(true);
        root.querySelector<HTMLButtonElement>('.tv-settings__back')!.click(); fixture.detectChanges();
        expect(root.querySelector('form')).toBeNull();
        expect(fixture.componentInstance.configForm.value.password).toBe('');
        expect(fixture.componentInstance.showSecret()).toBe(false);
        root.querySelector<HTMLButtonElement>('.broker-picker__broker')!.click(); fixture.detectChanges();
        fixture.componentInstance.isConnecting.set(true); fixture.detectChanges();
        expect(root.querySelector<HTMLButtonElement>('.tv-settings__back')!.disabled).toBe(true);
        expect(root.querySelector<HTMLButtonElement>('.tv-settings__form-cancel')!.disabled).toBe(true);
        fixture.componentInstance.isConnecting.set(false); fixture.detectChanges();
        root.querySelector<HTMLButtonElement>('.tv-settings__form-cancel')!.click(); fixture.detectChanges();
        await fixture.whenStable();
        expect(root.querySelector('.tv-settings__add-btn')).not.toBeNull();
        expect(document.activeElement).toBe(root.querySelector('.tv-settings__add-btn'));

        root.querySelector<HTMLButtonElement>('.tv-settings__add-btn')!.click(); fixture.detectChanges();
        expect(root.querySelector('app-broker-picker')).not.toBeNull();
        expect(root.querySelector('form')).toBeNull();
        root.querySelector<HTMLButtonElement>('.broker-picker__close')!.click(); fixture.detectChanges();
        expect(root.querySelector('app-broker-picker')).toBeNull();
    });
});

describe('connect then import', () => {
    it('waits for account discovery and ignores duplicate connect clicks', async () => {
        const accounts = new Subject<any[]>();
        const fullSync = vi.fn(async () => 3);
        const simpleLogin = vi.fn(() => of({ connectionId: 'connection' }));
        TestBed.configureTestingModule({ providers: [FormBuilder,
            { provide: Router, useValue: {} },
            { provide: DemoModeService, useValue: { requireAccount: () => true } },
            { provide: TradovateService, useValue: { simpleLogin, connections: () => [{ id: 'connection' }], getAccountsForConnection: () => accounts } },
            { provide: SyncService, useValue: { fullSync, isSyncing: () => false, lastError: () => null } },
            { provide: AccountSettingsService, useValue: {} },
            { provide: TradeService, useValue: {} },
            { provide: UserSessionService, useValue: { capture: () => ({}), assertCurrent: () => {}, isCurrent: () => true } },
        ] });
        const component = TestBed.runInInjectionContext(() => new TradovateSettingsComponent());
        component.configForm.patchValue({ connectionName: 'Broker', username: 'user', password: 'test' });
        await component.connect();
        expect(simpleLogin).not.toHaveBeenCalled(); // Never authenticate before selecting a provider.
        component.showAddConnection.set(true);
        component.selectedBroker.set('tradovate');
        const connecting = component.connect();
        await Promise.resolve();
        await component.connect();
        expect(simpleLogin).toHaveBeenCalledOnce();
        expect(fullSync).not.toHaveBeenCalled();
        expect(component.isConnecting()).toBe(true);
        component.backToBrokers(); component.toggleAddConnection();
        expect(component.selectedBroker()).toBe('tradovate');
        expect(component.showAddConnection()).toBe(true);
        accounts.next([{ id: 1 }]);
        await connecting;
        expect(fullSync).toHaveBeenCalledOnce();
        expect(component.isConnecting()).toBe(false);
        expect(component.configForm.value.password).toBe('');
        expect(component.selectedBroker()).toBeNull();
        expect(component.showAddConnection()).toBe(false);
    });
});
