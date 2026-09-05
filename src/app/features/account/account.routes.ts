import { Routes } from '@angular/router';
import { planGuard } from '../../core/guards/plan.guard';

/** Route-backed settings sections stay directly linkable as the list grows. */
export const ACCOUNT_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./account.component').then(m => m.AccountComponent),
        children: [
            { path: '', redirectTo: 'profile', pathMatch: 'full' },
            {
                path: 'profile',
                loadComponent: () => import('./sections/account-profile/account-profile.component')
                    .then(m => m.AccountProfileComponent)
            },
            {
                path: 'sign-in',
                loadComponent: () => import('./sections/account-connections/account-connections.component')
                    .then(m => m.AccountConnectionsComponent)
            },
            {
                path: 'plan',
                loadComponent: () => import('./sections/account-plan/account-plan.component')
                    .then(m => m.AccountPlanComponent)
            },
            {
                path: 'integrations',
                canActivate: [planGuard('broker')],
                loadComponent: () => import('../integrations/settings-page/settings-page.component')
                    .then(m => m.SettingsPageComponent)
            },
            {
                path: 'alerts',
                loadComponent: () => import('./sections/account-alerts/account-alerts.component')
                    .then(m => m.AccountAlertsComponent)
            },
            {
                path: 'appearance',
                loadComponent: () => import('./sections/account-appearance/account-appearance.component')
                    .then(m => m.AccountAppearanceComponent)
            },
            {
                path: 'data',
                loadComponent: () => import('./sections/account-danger/account-danger.component')
                    .then(m => m.AccountDangerComponent)
            }
        ]
    }
];
