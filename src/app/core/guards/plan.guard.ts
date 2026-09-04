import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PlanTier } from '../models/user.model';
import { DemoModeService } from '../services/demo-mode.service';

/**
 * Route guard for plan-gated features.
 *
 * Usage in routes:
 *   canActivate: [authGuard, planGuard('premium')]
 */
export const planGuard = (requiredPlan: 'premium' | 'lifetime'): CanActivateFn =>
    async () => {
        if (inject(DemoModeService).active()) return true;

        const auth = inject(AuthService);
        const router = inject(Router);

        // Session restore + profile (plan) load happen async on hard refresh.
        await auth.authReady;
        await auth.refreshProfile();

        if (auth.discordReauthRequired()) return router.createUrlTree(['/account']);

        const plan: PlanTier = auth.plan();

        const tierRank: Record<PlanTier, number> = { free: 0, premium: 1, lifetime: 1, admin: 2 };
        const allowed = tierRank[plan] >= tierRank[requiredPlan];

        // Free users are routed into the demo workspace so they see a populated
        // app rather than a blank paywall. /upgrade is still reachable from
        // the demo banner and the upgrade prompt.
        return allowed || router.createUrlTree(['/demo']);
    };
