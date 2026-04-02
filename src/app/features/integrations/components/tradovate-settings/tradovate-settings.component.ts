import { Component, signal, inject, computed } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TradovateService, TradovateConnection } from '../../../../core/services/tradovate.service';
import { SyncService } from '../../../../core/services/sync.service';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { TradeService } from '../../../../core/services/trade.service';

@Component({
    selector: 'app-tradovate-settings',
    standalone: true,
    imports: [ReactiveFormsModule, FormsModule],
    templateUrl: './tradovate-settings.component.html',
    styleUrl: './tradovate-settings.component.scss'
})
export class TradovateSettingsComponent {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    tradovateService = inject(TradovateService);
    syncService = inject(SyncService);
    accountSettings = inject(AccountSettingsService);
    private tradeService = inject(TradeService);

    configForm: FormGroup;
    isSaved = signal(false);
    showSecret = signal(false);
    authMode = signal<'oauth' | 'direct'>('direct');
    isConnecting = signal(false);
    showAddConnection = signal(false);

    // Sync state
    syncError = signal<string | null>(null);
    syncResult = signal<number | null>(null);
    customFromDate = signal(this.defaultFromDate(30));
    activePreset = signal<number | null | undefined>(30);

    // Expose service signals
    connections = this.tradovateService.connections;
    isSyncing = this.syncService.isSyncing;
    syncLog = this.syncService.syncLog;
    syncProgress = this.syncService.syncProgress;

    constructor() {
        this.configForm = this.fb.group({
            connectionName: ['', Validators.required],
            authMode: ['direct'],
            environment: ['demo'],
            apiKey: [''],
            apiSecret: [''],
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
        this.syncError.set(null);
        this.syncResult.set(null);
        const fromDate = new Date(this.customFromDate() + 'T00:00:00');
        try {
            const count = await this.syncService.syncFrom(fromDate);
            this.syncResult.set(count);
        } catch (err: any) {
            this.syncError.set(err.message || 'Sync failed');
        }
    }

    async fullSync(): Promise<void> {
        this.syncError.set(null);
        this.syncResult.set(null);
        try {
            const count = await this.syncService.fullSync();
            this.syncResult.set(count);
        } catch (err: any) {
            this.syncError.set(err.message || 'Sync failed');
        }
    }

    setAuthMode(mode: 'oauth' | 'direct'): void {
        this.authMode.set(mode);
        this.configForm.patchValue({ authMode: mode });
    }

    toggleSecret(): void {
        this.showSecret.update(v => !v);
    }

    toggleAddConnection(): void {
        this.showAddConnection.update(v => !v);
        if (!this.showAddConnection()) {
            this.configForm.reset({
                connectionName: '', authMode: 'direct', environment: 'demo',
                username: '', password: ''
            });
        }
    }

    connect(): void {
        if (!this.configForm.valid) return;
        this.isConnecting.set(true);
        const values = this.configForm.value;

        if (this.authMode() === 'oauth') {
            alert('OAuth flow will be implemented in a future update.');
            this.isConnecting.set(false);
            return;
        }

        this.tradovateService.simpleLogin(
            values.username,
            values.password,
            values.connectionName || 'Tradovate Account',
            values.environment || 'demo'
        ).subscribe({
            next: ({ connectionId }) => {
                this.isConnecting.set(false);
                this.showAddConnection.set(false);
                this.isSaved.set(true);
                this.configForm.reset();
                this.loadAccountsForConnection(connectionId);
                setTimeout(() => this.isSaved.set(false), 3000);
            },
            error: (err) => {
                this.isConnecting.set(false);
                alert(err.message || 'Login failed. Please check your Tradovate credentials.');
            }
        });
    }

    private loadAccountsForConnection(connectionId: string): void {
        const conn = this.tradovateService.connections().find(c => c.id === connectionId);
        if (!conn) return;
        this.tradovateService.getAccountsForConnection(conn).subscribe({
            error: (err) => console.error('[TradovateSettings] Failed to load accounts for', conn.name, err)
        });
    }

    disconnectConnection(connectionId: string): void {
        if (confirm('Are you sure you want to remove this connection?')) {
            this.tradovateService.removeConnection(connectionId);
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

    back(): void {
        this.router.navigate(['/journal/trades']);
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
