import { ChangeDetectionStrategy, Component, computed, input, signal, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PublicNavComponent } from '../../../shared/components/public-nav/public-nav.component';
import { safeAuthReturnUrl } from '../auth-return-url';
import { pricingIntentFromUrl } from '../../account/pricing/pricing-intent';
import { SUBSCRIPTION_PLANS } from '../../account/subscription-plans';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, PublicNavComponent, CurrencyPipe],
    templateUrl: './login.html',
    styleUrl: './login.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
    private fb = inject(FormBuilder);
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    readonly embedded = input(false);
    readonly returnTo = input<string | null>(null);
    readonly destination = computed(() => safeAuthReturnUrl(this.returnTo() ?? this.route.snapshot.queryParams['returnUrl']));
    readonly intent = computed(() => pricingIntentFromUrl(this.destination()));
    readonly selectedPlan = computed(() => SUBSCRIPTION_PLANS.find(plan => plan.id === this.intent()?.plan));
    readonly busy = computed(() => this.isLoading() || this.isDiscordLoading() || this.isGoogleLoading());

    loginForm: FormGroup = this.fb.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(3)]]
    });

    errorMessage = signal<string | null>(null);
    isLoading = signal(false);
    isDiscordLoading = signal(false);
    isGoogleLoading = signal(false);

    /**
     * Email/password sign-in is hidden for now — the login page offers Discord
     * and Google only. The form, validators and onSubmit() are all still wired
     * up, so flipping this back to `isDevMode()` (or `true`) restores the whole
     * block with no other changes.
     *
     * NOTE: Supabase password auth itself is untouched — identities linked from
     * the Account page keep working, this only hides the sign-in form.
     */
    readonly emailAuthEnabled = false;

    constructor() {
        if (!this.emailAuthEnabled) {
            this.loginForm.disable();
        }
        if (this.route.snapshot.queryParams['reason'] === 'session-expired') {
            this.errorMessage.set('Your session has expired. Sign in again to continue where you left off.');
        }
    }

    async loginWithDiscord(): Promise<void> {
        if (this.busy()) return;
        this.isDiscordLoading.set(true);
        this.errorMessage.set(null);
        try {
            // Redirects to Discord; /auth/callback handles the return trip
            // (including navigation to returnUrl), so no navigation here.
            await this.authService.loginWithDiscord(this.destination());
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Discord login failed. Please try again.');
            this.isDiscordLoading.set(false);
        }
    }

    async loginWithGoogle(): Promise<void> {
        if (this.busy()) return;
        this.isGoogleLoading.set(true);
        this.errorMessage.set(null);
        try {
            // Redirects to Google; /auth/callback handles the return trip.
            await this.authService.loginWithGoogle(this.destination());
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Google login failed. Please try again.');
            this.isGoogleLoading.set(false);
        }
    }

    async onSubmit(): Promise<void> {
        if (!this.emailAuthEnabled || this.busy()) {
            return;
        }
        if (this.loginForm.invalid) {
            this.loginForm.markAllAsTouched();
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            const result = await this.authService.login(this.loginForm.value);
            if (result.success) {
                void this.router.navigateByUrl(this.destination());
            } else {
                this.errorMessage.set(result.error || 'Login failed');
            }
        } catch {
            this.errorMessage.set('Could not sign in. Check your connection and try again.');
        } finally {
            this.isLoading.set(false);
        }
    }

    get email() { return this.loginForm.get('email'); }
    get password() { return this.loginForm.get('password'); }
    emailTouched(): boolean { return !!this.loginForm.get('email')?.touched; }
    passwordTouched(): boolean { return !!this.loginForm.get('password')?.touched; }
}
