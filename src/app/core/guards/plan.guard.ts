import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PlanTier } from '../models/user.model';

/**
 * Route guard for plan-gated features.
 *
 * Usage in routes:
 *   canActivate: [authGuard, planGuard('premium')]
 */
export const planGuard = (requiredPlan: 'premium' | 'lifetime'): CanActivateFn =>
    () => {
        const auth = inject(AuthService);
        const router = inject(Router);

        const plan: PlanTier = auth.plan();

        const tierRank: Record<PlanTier, number> = { free: 0, premium: 1, lifetime: 2, admin: 3 };
        const allowed = tierRank[plan] >= tierRank[requiredPlan];

        return allowed || router.createUrlTree(['/upgrade']);
    };
