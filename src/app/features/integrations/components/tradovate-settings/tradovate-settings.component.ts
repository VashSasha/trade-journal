import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TradovateService } from '../../../../core/services/tradovate.service';

@Component({
    selector: 'app-tradovate-settings',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './tradovate-settings.component.html',
    styles: []
})
export class TradovateSettingsComponent {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    private tradovateService = inject(TradovateService);

    configForm: FormGroup;
    isSaved = signal(false);
    showSecret = signal(false);
    isConnected = signal(!!localStorage.getItem('tradovate_token'));
    authMode = signal<'oauth' | 'direct'>('oauth');
    isConnecting = signal(false);
    account = signal<any>(null);
    balance = signal<any>(null);
    showAdvanced = signal(false);

    get redirectUri(): string {
        return window.location.origin + '/settings/tradovate/callback';
    }

    constructor() {
        const savedConfig = localStorage.getItem('tradovate_config');
        const initialValues = savedConfig ? JSON.parse(savedConfig) : {
            apiKey: '',
            apiSecret: '',
            authMode: 'oauth',
            username: '',
            password: '',
            apiPassword: '',
            environment: 'demo'
        };

        this.authMode.set(initialValues.authMode || 'oauth');

        this.configForm = this.fb.group({
            authMode: [initialValues.authMode || 'oauth'],
            environment: [initialValues.environment || 'demo'],
            // OAuth fields
            apiKey: [initialValues.apiKey],
            apiSecret: [initialValues.apiSecret],
            // Direct Login fields
            username: [initialValues.username],
            password: [initialValues.password],
            apiPassword: [initialValues.apiPassword]
        });

        // Set validators based on mode
        this.updateValidators(initialValues.authMode || 'oauth');

        if (this.isConnected()) {
            this.loadAccountInfo();
        }
    }

    private loadAccountInfo(): void {
        this.tradovateService.getAccounts().subscribe({
            next: (accounts) => {
                if (accounts && accounts.length > 0) {
                    this.account.set(accounts[0]);
                    this.loadBalance();
                }
            },
            error: (err) => {
                console.error('Failed to load accounts', err);
                if (err.status === 401) {
                    this.disconnect();
                }
            }
        });
    }

    private loadBalance(): void {
        this.tradovateService.getCashBalances().subscribe({
            next: (balances) => {
                const acc = this.account();
                if (acc && balances) {
                    const bal = balances.find(b => b.accountId === acc.id);
                    this.balance.set(bal);
                }
            },
            error: (err) => console.error('Failed to load balance', err)
        });
    }

    setAuthMode(mode: 'oauth' | 'direct'): void {
        this.authMode.set(mode);
        this.configForm.patchValue({ authMode: mode });
        this.updateValidators(mode);
    }

    updateValidators(mode: 'oauth' | 'direct'): void {
        const apiKey = this.configForm.get('apiKey');
        const apiSecret = this.configForm.get('apiSecret');
        const username = this.configForm.get('username');
        const password = this.configForm.get('password');
        const apiPassword = this.configForm.get('apiPassword');

        if (mode === 'oauth') {
            apiKey?.setValidators([Validators.required]);
            apiSecret?.setValidators([Validators.required]);
            username?.clearValidators();
            password?.clearValidators();
            apiPassword?.clearValidators();
        } else {
            // Direct login (TradingView-style) only requires username/password
            // No API credentials needed!
            username?.setValidators([Validators.required]);
            password?.setValidators([Validators.required]);

            // API credentials are not required for simple login
            apiKey?.clearValidators();
            apiSecret?.clearValidators();
            apiPassword?.clearValidators();
        }

        apiKey?.updateValueAndValidity();
        apiSecret?.updateValueAndValidity();
        username?.updateValueAndValidity();
        password?.updateValueAndValidity();
        apiPassword?.updateValueAndValidity();
    }

    toggleSecret(): void {
        this.showSecret.update(v => !v);
    }

    toggleAdvanced(): void {
        this.showAdvanced.update(v => !v);
    }

    onSubmit(): void {
        if (this.configForm.valid) {
            localStorage.setItem('tradovate_config', JSON.stringify(this.configForm.value));
            this.isSaved.set(true);
            setTimeout(() => this.isSaved.set(false), 3000);
        }
    }

    connect(): void {
        if (!this.configForm.valid) return;

        // Save config first
        localStorage.setItem('tradovate_config', JSON.stringify(this.configForm.value));

        if (this.authMode() === 'oauth') {
            this.initiateOAuth();
        } else {
            this.loginDirectly();
        }
    }

    private initiateOAuth(): void {
        const isDemo = this.configForm.value.environment === 'demo';
        const clientId = this.configForm.value.apiKey;
        const redirectUri = encodeURIComponent(this.redirectUri);

        const host = isDemo ? 'demo.tradovateapi.com' : 'trader.tradovate.com';
        const authUrl = `https://${host}/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
        window.location.href = authUrl;
    }

    private loginDirectly(): void {
        this.isConnecting.set(true);
        const username = this.configForm.value.username;
        const password = this.configForm.value.password;

        this.tradovateService.simpleLogin(username, password).subscribe({
            next: () => {
                this.isConnecting.set(false);
                this.isConnected.set(true);
                this.isSaved.set(true);
                this.loadAccountInfo();
                setTimeout(() => this.isSaved.set(false), 3000);
            },
            error: (err) => {
                this.isConnecting.set(false);
                const msg = err.message || 'Login failed. Please check your Tradovate username and password.';
                alert(msg);
            }
        });
    }

    disconnect(): void {
        localStorage.removeItem('tradovate_token');
        this.isConnected.set(false);
        this.account.set(null);
        this.balance.set(null);
    }

    back(): void {
        this.router.navigate(['/journal/trades']);
    }
}
