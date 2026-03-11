import { Component, OnInit, inject, signal } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { TradovateService } from '../../../../core/services/tradovate.service';

@Component({
    selector: 'app-tradovate-callback',
    standalone: true,
    imports: [],
    template: `
    <div class="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div class="w-full max-w-md rounded-xl bg-white p-8 shadow-sm dark:bg-slate-900">
            <h2 class="mb-4 text-2xl font-bold text-slate-900 dark:text-white">Connecting to Tradovate...</h2>
            
            @if (status() === 'loading') {
                <div class="flex items-center gap-3 text-slate-600 dark:text-slate-400">
                    <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Exchanging authorization code for access token...
                </div>
            }

            @if (status() === 'error') {
                <div class="rounded-lg bg-red-100 p-4 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    <p class="font-medium">Connection Failed</p>
                    <p class="mt-1 text-sm">{{ errorMessage() }}</p>
                    <button (click)="retry()" class="mt-4 font-semibold underline">Back to Settings</button>
                </div>
            }

            @if (status() === 'success') {
                <div class="rounded-lg bg-emerald-100 p-4 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <p class="font-medium">Successfully Connected!</p>
                    <p class="text-sm">Redirecting you back...</p>
                </div>
            }
        </div>
    </div>
    `
})
export class TradovateCallbackComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private tradovateService = inject(TradovateService);

    status = signal<'loading' | 'success' | 'error'>('loading');
    errorMessage = signal<string | null>(null);

    ngOnInit(): void {
        const code = this.route.snapshot.queryParamMap.get('code');
        const error = this.route.snapshot.queryParamMap.get('error');

        if (error) {
            this.handleError(error);
            return;
        }

        if (code) {
            this.exchangeCode(code);
        } else {
            this.handleError('No authorization code found in redirect URL.');
        }
    }

    private exchangeCode(code: string): void {
        this.status.set('loading');
        this.tradovateService.exchangeCodeForToken(code).subscribe({
            next: (res) => {
                this.status.set('success');
                setTimeout(() => {
                    this.router.navigate(['/settings']);
                }, 2000);
            },
            error: (err) => {
                this.handleError('Failed to exchange code for token. Ensure your Client ID and Secret are correct.');
            }
        });
    }

    private handleError(msg: string): void {
        this.status.set('error');
        this.errorMessage.set(msg);
    }

    retry(): void {
        this.router.navigate(['/settings']);
    }
}
