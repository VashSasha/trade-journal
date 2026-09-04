import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AccessPolicyService, PaidFeature } from '../services/access-policy.service';

/**
 * Route guard for plan-gated features.
 *
 * Usage in routes:
 *   canActivate: [authGuard, planGuard('analytics')]
 */
export const planGuard = (feature: PaidFeature): CanActivateFn =>
    async (_route, state) => {
        const access = inject(AccessPolicyService);
        const auth = inject(AuthService);
        const router = inject(Router);
        if (!access.demo()) {
            await auth.authReady;
            await auth.refreshProfile();
        }
        if (access.canOpen(feature)) return true;
        if (!auth.isAuthenticated()) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
        // Never silently switch a user's data source to demo.
        return router.createUrlTree(['/upgrade'], { queryParams: { feature } });
    };
