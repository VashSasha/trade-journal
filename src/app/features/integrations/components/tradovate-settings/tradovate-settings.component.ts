import { afterNextRender, Component, DestroyRef, ElementRef, Injector, signal, inject, viewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TradovateService, TradovateConnection } from '../../../../core/services/tradovate.service';
import { SyncService } from '../../../../core/services/sync.service';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { TradeService } from '../../../../core/services/trade.service';
import { DemoModeService } from '../../../../core/services/demo-mode.service';
import { UserSessionService } from '../../../../core/services/user-session.service';
import { BrokerSyncStatusComponent } from '../../sync-status/broker-sync-status.component';
import { BrokerPickerComponent } from '../../broker-picker/broker-picker.component';
import { BrokerId, TRADOVATE_BROKER } from '../../broker-picker/broker-catalog';

@Component({
    selector: 'app-tradovate-settings',
    standalone: true,
    imports: [ReactiveFormsModule, FormsModule, BrokerSyncStatusComponent, BrokerPickerComponent],
    templateUrl: './tradovate-settings.component.html',
    styleUrl: './tradovate-settings.component.scss'
})
export class TradovateSettingsComponent {
    private fb = inject(FormBuilder);
    private demo = inject(DemoModeService);
    tradovateService = inject(TradovateService);
    syncService = inject(SyncService);
    accountSettings = inject(AccountSettingsService);
    private tradeService = inject(TradeService);
    private session = inject(UserSessionService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
    private readonly formHeading = viewChild<ElementRef<HTMLHeadingElement>>('formHeading');
    readonly selectedBroker = signal<BrokerId | null>(null);
    readonly tradovateBroker = TRADOVATE_BROKER;

    configForm: FormGroup;
    isSaved = signal(false);
    showSecret = signal(false);
    isConnecting = signal(false);
    showAddConnection = signal(false);

    // Sync state
    syncError = signal<string | null>(null);
    syncResult = signal<number | null>(null);
    customFromDate = signal(this.defaultFromDate(30));
    activePreset = signal<number | null | undefined>(30);

    // Expose service signals — settings shows all non-removed connections (including disabled)
    connections = this.tradovateService.settingsConnections;
    isSyncing = this.syncService.isSyncing;
    syncLog = this.syncService.syncLog;
    syncProgress = this.syncService.syncProgress;

    constructor() {
        this.configForm = this.fb.group({
            connectionName: ['', Validators.required],
            environment: ['demo'],
            username: ['', Validators.required],
            password: ['', Validators.required]
        });
    }

    private defaultFromDate(daysAgo: number): string {
        return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    setPreset(daysAgo: number | null): void {
        this.activePreset.set(daysAgo);
        if (daysAgo === null) {
            this.customFromDate.set('2020-01-01');
        } else {
            this.customFromDate.set(this.defaultFromDate(daysAgo));
        }
    }

    async startSync(): Promise<void> {
        if (this.isSyncing()) return;
        if (!this.demo.requireAccount('sync')) return;
        this.syncError.set(null);
        this.syncResult.set(null);
        const fromDate = new Date(this.customFromDate() + 'T00:00:00');
        try {
            const count = await this.syncService.syncFrom(fromDate);
            this.syncResult.set(count);
        } catch (err: any) {
            // SyncService owns the shared result, including targeted retries.
            if (!this.syncService.lastError()) this.syncError.set(err.message || 'Sync failed');
        }
    }

    async fullSync(): Promise<void> {
        if (this.isSyncing()) return;
        if (!this.demo.requireAccount('sync')) return;
        this.syncError.set(null);
        this.syncResult.set(null);
        try {
            const count = await this.syncService.fullSync();
            this.syncResult.set(count);
        } catch (err: any) {
            if (!this.syncService.lastError()) this.syncError.set(err.message || 'Sync failed');
        }
    }

    toggleSecret(): void {
        this.showSecret.update(v => !v);
    }

    toggleAddConnection(): void {
        if (this.isConnecting()) return;
        this.showAddConnection.update(v => !v);
        this.selectedBroker.set(null);
        if (!this.showAddConnection()) {
            this.resetConnectionForm();
            this.focusAddButton();
        }
    }

    selectBroker(broker: BrokerId): void {
        if (this.isConnecting() || !this.showAddConnection() || broker !== 'tradovate') return;
        this.selectedBroker.set(broker);
        afterNextRender(() => this.formHeading()?.nativeElement.focus(), { injector: this.injector });
    }

    backToBrokers(): void {
        if (this.isConnecting()) return;
        this.resetConnectionForm();
        this.selectedBroker.set(null);
    }

    private resetConnectionForm(): void {
        this.configForm.reset({ connectionName: '', environment: 'demo', username: '', password: '' });
        this.showSecret.set(false);
    }

    private focusAddButton(): void {
        if (this.destroyRef.destroyed) return;
        afterNextRender(() => this.addButton()?.nativeElement.focus(), { injector: this.injector });
    }

    async connect(): Promise<void> {
        if (this.selectedBroker() !== 'tradovate' || !this.showAddConnection()) return;
        if (!this.demo.requireAccount('connect')) return;
        if (!this.configForm.valid || this.isConnecting()) return;
        const scope = this.session.capture();
        this.isConnecting.set(true);
        this.syncError.set(null);
        const values = this.configForm.value;
        try {
            const { connectionId } = await firstValueFrom(this.tradovateService.simpleLogin(
            values.username,
            values.password,
            values.connectionName || 'Tradovate Account',
            values.environment || 'demo'
            ));
            this.session.assertCurrent(scope);
            this.configForm.patchValue({ password: '' });
            const conn = this.tradovateService.connections().find(c => c.id === connectionId);
            if (!conn) throw new Error('Connection changed. Please reconnect.');
            // The first import must wait for account discovery; otherwise it can
            // report an empty success before the broker accounts have arrived.
            await firstValueFrom(this.tradovateService.getAccountsForConnection(conn));
            this.session.assertCurrent(scope);
            this.showAddConnection.set(false);
            this.selectedBroker.set(null);
            this.isSaved.set(true);
            this.resetConnectionForm();
            this.focusAddButton();
            await this.fullSync();
        } catch (err) {
            if (this.session.isCurrent(scope)) this.syncError.set(err instanceof Error ? err.message : 'Connection failed. Please try again.');
        } finally {
            this.isConnecting.set(false);
        }
    }

    disconnectConnection(connectionId: string): void {
        if (confirm('Disconnect this broker? All saved accounts, balances and trades will remain available.')) {
            this.tradovateService.removeConnection(connectionId);
        }
    }

    toggleConnectionDisabled(conn: TradovateConnection): void {
        if (conn.disabled) {
            this.tradovateService.enableConnection(conn.id);
        } else {
            this.tradovateService.disableConnection(conn.id);
        }
    }

    resetAllTrades(): void {
        if (confirm('Delete all trades? This cannot be undone.')) {
            this.tradeService.clearAllTrades();
            this.syncService.clearLog();
            this.syncResult.set(null);
            this.syncError.set(null);
        }
    }

    getConnectionEnvironment(conn: TradovateConnection): string {
        return conn.config.environment === 'live' ? 'Live' : 'Demo';
    }

    activeAccountCount(conn: TradovateConnection): number {
        return conn.accounts.filter(a => a.active !== false).length;
    }

    formatDate(dateString: string): string {
        return new Date(dateString).toLocaleString();
    }
}
