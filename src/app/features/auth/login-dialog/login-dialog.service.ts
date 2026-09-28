import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { safeAuthReturnUrl } from '../auth-return-url';

/** Provided by the landing page only; other entry points keep the /login route. */
@Injectable()
export class LoginDialogService {
    private readonly router = inject(Router);
    readonly request = signal<{ returnUrl: string } | null>(null);

    open(returnUrl = '/dashboard'): void {
        const destination = safeAuthReturnUrl(returnUrl);
        if (window.matchMedia('(max-width: 600px)').matches
            || typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function') {
            void this.router.navigate(['/login'], { queryParams: { returnUrl: destination } });
            return;
        }
        this.request.set({ returnUrl: destination });
    }

    close(): void { this.request.set(null); }
}
