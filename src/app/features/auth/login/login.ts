import { Component, signal, inject, isDevMode } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PublicNavComponent } from '../../../shared/components/public-nav/public-nav.component';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, PublicNavComponent],
    templateUrl: './login.html',
    styleUrl: './login.scss'
})
export class LoginComponent {
    private fb = inject(FormBuilder);
    private authService = inject(AuthService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    loginForm: FormGroup = this.fb.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(3)]]
    });

    errorMessage = signal<string | null>(null);
    isLoading = signal(false);
    isDiscordLoading = signal(false);

    /** Email login (Supabase password auth) is dev-only; production is Discord-only. */
    readonly emailAuthEnabled = isDevMode();

    constructor() {
        if (!this.emailAuthEnabled) {
            this.loginForm.disable();
        }
        if (this.route.snapshot.queryParams['reason'] === 'session-expired') {
            this.errorMessage.set('You were signed out after 30 minutes of inactivity. Please sign in again.');
        }
    }

    async loginWithDiscord(): Promise<void> {
        this.isDiscordLoading.set(true);
        this.errorMessage.set(null);
        try {
            // Redirects to Discord; /auth/callback handles the return trip
            // (including navigation to returnUrl), so no navigation here.
            const returnUrl = this.route.snapshot.queryParams['returnUrl'];
            await this.authService.loginWithDiscord(returnUrl);
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Discord login failed. Please try again.');
            this.isDiscordLoading.set(false);
        }
    }

    async onSubmit(): Promise<void> {
        if (!this.emailAuthEnabled) {
            return;
        }
        if (this.loginForm.invalid) {
            this.loginForm.markAllAsTouched();
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        const result = await this.authService.login(this.loginForm.value);
        this.isLoading.set(false);

        if (result.success) {
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
            this.router.navigateByUrl(returnUrl);
        } else {
            this.errorMessage.set(result.error || 'Login failed');
        }
    }

    get email() { return this.loginForm.get('email'); }
    get password() { return this.loginForm.get('password'); }
    emailTouched(): boolean { return !!this.loginForm.get('email')?.touched; }
    passwordTouched(): boolean { return !!this.loginForm.get('password')?.touched; }
}
