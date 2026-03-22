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

    onSubmit(): void {
        if (this.loginForm.invalid) {
            this.loginForm.markAllAsTouched();
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        const credentials = this.loginForm.value;
        const result = this.authService.login(credentials);

        this.isLoading.set(false);

        if (result.success) {
            // Get return URL from query params or default to dashboard
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
            this.router.navigateByUrl(returnUrl);
        } else {
            this.errorMessage.set(result.error || 'Login failed');
        }
    }

    get email() {
        return this.loginForm.get('email');
    }

    get password() {
        return this.loginForm.get('password');
    }

    emailTouched(): boolean { return !!this.loginForm.get('email')?.touched; }
    passwordTouched(): boolean { return !!this.loginForm.get('password')?.touched; }
}
