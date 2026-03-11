import { Component, signal, inject, computed } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TradovateService, TradovateConnection } from '../../../../core/services/tradovate.service';

@Component({
    selector: 'app-tradovate-settings',
    standalone: true,
    imports: [ReactiveFormsModule],
    templateUrl: './tradovate-settings.component.html'
})
export class TradovateSettingsComponent {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    tradovateService = inject(TradovateService);

    configForm: FormGroup;
    isSaved = signal(false);
    showSecret = signal(false);
    authMode = signal<'oauth' | 'direct'>('direct');
    isConnecting = signal(false);
    showAdvanced = signal(false);
    showAddConnection = signal(false);
    connectionName = signal('');

    // Computed from service
    connections = this.tradovateService.connections;
    activeConnectionId = this.tradovateService.activeConnectionId;
    activeConnection = this.tradovateService.activeConnection;

    constructor() {
        this.configForm = this.fb.group({
            connectionName: ['', Validators.required],
            authMode: ['direct'],
            environment: ['demo'],
            // OAuth fields
            apiKey: [''],
            apiSecret: [''],
            // Direct Login fields
            username: ['', Validators.required],
            password: ['', Validators.required]
        });
    }

    setAuthMode(mode: 'oauth' | 'direct'): void {
        this.authMode.set(mode);
        this.configForm.patchValue({ authMode: mode });
    }

    toggleSecret(): void {
        this.showSecret.update(v => !v);
    }

    toggleAdvanced(): void {
        this.showAdvanced.update(v => !v);
    }

    toggleAddConnection(): void {
        this.showAddConnection.update(v => !v);
        if (!this.showAddConnection()) {
            this.configForm.reset({
                connectionName: '',
                authMode: 'direct',
                environment: 'demo',
                username: '',
                password: ''
            });
        }
    }

    connect(): void {
        if (!this.configForm.valid) return;

        this.isConnecting.set(true);
        const values = this.configForm.value;
        const connectionName = values.connectionName || 'Tradovate Account';
        const environment = values.environment || 'demo';

        if (this.authMode() === 'oauth') {
            // TODO: Implement OAuth flow with connection name
            alert('OAuth flow with multi-account will be implemented');
            this.isConnecting.set(false);
        } else {
            this.tradovateService.simpleLogin(
                values.username,
                values.password,
                connectionName,
                environment
            ).subscribe({
                next: ({ connectionId }) => {
                    this.isConnecting.set(false);
                    this.showAddConnection.set(false);
                    this.isSaved.set(true);
                    this.configForm.reset();

                    // Load accounts for this connection
                    this.loadAccountsForConnection(connectionId);

                    setTimeout(() => this.isSaved.set(false), 3000);
                },
                error: (err) => {
                    this.isConnecting.set(false);
                    const msg = err.message || 'Login failed. Please check your Tradovate username and password.';
                    alert(msg);
                }
            });
        }
    }

    private loadAccountsForConnection(connectionId: string): void {
        // Temporarily set as active to fetch accounts
        const previousActive = this.activeConnectionId();
        this.tradovateService.setActiveConnection(connectionId);

        this.tradovateService.getAccounts().subscribe({
            next: (accounts) => {
                this.tradovateService.updateConnectionAccounts(connectionId, accounts);

                // Restore previous active connection if needed
                if (previousActive && previousActive !== connectionId) {
                    this.tradovateService.setActiveConnection(previousActive);
                } else {
                    // Keep this one as active
                    this.tradovateService.setActiveConnection(connectionId);
                }
            },
            error: (err) => {
                console.error('Failed to load accounts for connection:', err);
                // Restore previous active
                if (previousActive) {
                    this.tradovateService.setActiveConnection(previousActive);
                }
            }
        });
    }

    setActiveConnection(connectionId: string): void {
        this.tradovateService.setActiveConnection(connectionId);
    }

    disconnectConnection(connectionId: string): void {
        if (confirm('Are you sure you want to remove this connection?')) {
            this.tradovateService.removeConnection(connectionId);
        }
    }

    back(): void {
        this.router.navigate(['/journal/trades']);
    }

    getConnectionStatus(conn: TradovateConnection): string {
        return conn.id === this.activeConnectionId() ? 'Active' : 'Inactive';
    }

    getConnectionEnvironment(conn: TradovateConnection): string {
        return conn.config.environment === 'live' ? 'Live' : 'Demo';
    }

    formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
}
