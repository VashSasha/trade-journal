import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Completes the Supabase OAuth flow. supabase-js exchanges the code in the
 * URL automatically during client initialization; this component waits for
 * that to settle, resolves the plan server-side, then enters the app.
 */
@Component({
    selector: 'app-auth-callback',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './auth-callback.component.html',
    styleUrl: './auth-callback.component.scss'
})
export class AuthCallbackComponent implements OnInit {
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    error = signal<string | null>(null);

    async ngOnInit(): Promise<void> {
        const oauthError = this.route.snapshot.queryParamMap.get('error_description')
            ?? this.route.snapshot.queryParamMap.get('error');
        if (oauthError) {
            this.error.set(`Login failed: ${oauthError}`);
            return;
        }

        // Wait for supabase-js to finish exchanging the OAuth code for a session.
        await this.authService.authReady;

        const session = this.authService.session();
        if (!session) {
            this.error.set('Login failed — no session was established. Please try again.');
            return;
        }

        // The Discord provider token only exists right after OAuth login;
        // pass it to the resolve-plan Edge Function to verify roles.
        const providerToken = session.provider_token;
        if (providerToken) {
            try {
                await this.authService.resolvePlan(providerToken);
            } catch (err) {
                // Auth succeeded; plan resolution can be retried later. Don't block entry.
                console.warn('Plan resolution failed, continuing with current plan.', err);
            }
        }

        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
        this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    }
}
