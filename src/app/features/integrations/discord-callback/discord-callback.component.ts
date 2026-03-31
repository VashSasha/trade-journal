import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-discord-callback',
    standalone: true,
    imports: [],
    template: `
        <div class="oauth-callback">
            @if (error()) {
                <p class="oauth-callback__error">{{ error() }}</p>
                <a class="oauth-callback__link" routerLink="/login">Back to login</a>
            } @else {
                <p class="oauth-callback__message">Completing login...</p>
                <div class="oauth-callback__spinner"></div>
            }
        </div>
    `,
    styles: [`
        .oauth-callback {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            gap: 1rem;
            background: #0f172a;
            color: #94a3b8;
            font-family: sans-serif;

            &__message { font-size: 1rem; }

            &__error {
                color: #f87171;
                font-size: 0.875rem;
            }

            &__link {
                color: #5865f2;
                font-size: 0.875rem;
            }

            &__spinner {
                width: 2rem;
                height: 2rem;
                border: 3px solid #334155;
                border-top-color: #5865f2;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `]
})
export class DiscordCallbackComponent implements OnInit {
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    error = signal<string | null>(null);

    async ngOnInit(): Promise<void> {
        const code = this.route.snapshot.queryParamMap.get('code');
        const discordError = this.route.snapshot.queryParamMap.get('error');

        if (discordError) {
            this.error.set(`Discord login cancelled or denied: ${discordError}`);
            return;
        }

        if (!code) {
            this.error.set('No authorization code received from Discord.');
            return;
        }

        try {
            await this.authService.handleWebCallback(code);
            this.router.navigateByUrl('/dashboard');
        } catch (err: any) {
            this.error.set(err.message || 'Login failed. Please try again.');
        }
    }
}
