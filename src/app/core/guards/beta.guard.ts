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

    // Profile (beta_access, plan) loads async on session restore.
    await auth.authReady;

    // Beta testers get in via beta_access; paying customers get in via their
    // plan (a subscription is a valid way through the gate, so the paid funnel
    // isn't blocked). Everyone else is bounced to the /beta screen, which
    // offers the ways to gain access (join / subscribe).
    const hasAccess = auth.betaAccess() || auth.plan() !== 'free';

    return hasAccess || router.createUrlTree(['/beta']);
};
