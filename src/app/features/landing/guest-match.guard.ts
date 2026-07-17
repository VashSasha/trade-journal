import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Matches the route only for logged-out visitors.
 * Authenticated users fall through to the next route
 * (the main app shell, which redirects to /dashboard).
 */
export const guestMatchGuard: CanMatchFn = async () => {
    const authService = inject(AuthService);
    // Await session restore so a logged-in user hard-refreshing '/' lands on
    // the dashboard instead of flashing the public landing page.
    await authService.authReady;
    return !authService.isAuthenticated();
};
