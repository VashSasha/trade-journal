import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Matches the route only for logged-out visitors.
 * Authenticated users fall through to the next route
 * (the main app shell, which redirects to /dashboard).
 */
export const guestMatchGuard: CanMatchFn = () => {
    const authService = inject(AuthService);
    return !authService.isAuthenticated();
};
