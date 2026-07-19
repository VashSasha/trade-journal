import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

/**
 * Closed-beta gate for the main app shell.
 *
 * When `environment.betaGate` is on, a logged-in user whose profile lacks
 * `beta_access` is bounced to the standalone `/beta` screen. The flag only
 * controls routing UX — the authoritative decision is `profiles.beta_access`,
 * written server-side by resolve-plan and un-writable from the client.
 *
 * Runs after authGuard, so a session is guaranteed here; we still await
 * authReady to be safe on a hard refresh of a protected route.
 */
export const betaGuard: CanActivateFn = async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!environment.betaGate) return true;

    // Profile (beta_access) loads async on session restore.
    await auth.authReady;

    return auth.betaAccess() || router.createUrlTree(['/beta']);
};
