import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DemoModeService } from '../services/demo-mode.service';

export const authGuard: CanActivateFn = (_route, state) => {
    if (inject(DemoModeService).active()) return true;
    return signedInGuard(_route, state);
};

/** Personal account/security/billing pages are real, never guest demo previews. */
export const signedInGuard: CanActivateFn = async (_route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    // Wait for the initial Supabase session restore so a hard refresh of a
    // protected route doesn't bounce a logged-in user to /login.
    await authService.authReady;

    if (authService.isAuthenticated()) {
        return true;
    }

    // Redirect to login with return URL
    return router.createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url }
    });
};
