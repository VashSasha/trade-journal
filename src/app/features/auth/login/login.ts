import { Component, signal, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [ReactiveFormsModule],
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

    async loginWithDiscord(): Promise<void> {
        this.isDiscordLoading.set(true);
        this.errorMessage.set(null);
        try {
            await this.authService.loginWithDiscord();
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
            this.router.navigateByUrl(returnUrl);
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Discord login failed. Please try again.');
            this.isDiscordLoading.set(false);
        }
    }

    async onSubmit(): Promise<void> {
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
