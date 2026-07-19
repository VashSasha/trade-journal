import { Routes } from '@angular/router';
import { MainLayoutComponent } from './features/layout/main-layout/main-layout';
import { authGuard } from './core/guards/auth.guard';
import { planGuard } from './core/guards/plan.guard';
import { betaGuard } from './core/guards/beta.guard';
import { guestMatchGuard } from './features/landing/guest-match.guard';

export const routes: Routes = [
    {
        // Public landing page — only matches for logged-out visitors.
        // Authenticated users fall through to the app shell below (→ /dashboard).
        path: '',
        pathMatch: 'full',
        canMatch: [guestMatchGuard],
        loadComponent: () => import('./features/landing/landing.component').then(m => m.LandingComponent)
    },
    {
        // Explicit URL for the landing page — works for logged-in users too
        // (the '' route above only matches logged-out visitors).
        path: 'welcome',
        loadComponent: () => import('./features/landing/landing.component').then(m => m.LandingComponent)
    },
    {
        path: 'login',
        loadComponent: () => import('./features/auth/login/login').then(m => m.LoginComponent)
    },
    {
        // Supabase OAuth callback — completes the code exchange and plan resolution.
        path: 'auth/callback',
        loadComponent: () => import('./features/auth/callback/auth-callback.component')
            .then(m => m.AuthCallbackComponent)
    },
    {
        path: 'upgrade',
        canActivate: [authGuard],
        loadComponent: () => import('./features/upgrade/upgrade.component')
            .then(m => m.UpgradeComponent)
    },
    {
        // Closed-beta lock screen — logged in but not a beta tester.
        // Only authGuard: it must stay reachable without beta access,
        // otherwise betaGuard would redirect it to itself.
        path: 'beta',
        canActivate: [authGuard],
        loadComponent: () => import('./features/beta/beta-lock.component')
            .then(m => m.BetaLockComponent)
    },
    {
        path: '',
        component: MainLayoutComponent,
        canActivate: [authGuard, betaGuard],
        children: [
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            },
            {
                path: 'dashboard',
                loadComponent: () => import('./features/dashboard/dashboard').then(m => m.DashboardComponent)
            },
            {
                path: 'analytics',
                canActivate: [planGuard('premium')],
                loadComponent: () => import('./features/analytics/analytics-dashboard.component').then(m => m.AnalyticsDashboardComponent)
            },
            {
                path: 'reports',
                canActivate: [planGuard('lifetime')],
                loadComponent: () => import('./features/reports/ai-reports.component').then(m => m.AiReportsComponent)
            },
            {
                path: 'journal',
                loadComponent: () => import('./features/journal/layout/journal-layout.component').then(m => m.JournalLayoutComponent),
                children: [
                    {
                        path: '',
                        redirectTo: 'daily',
                        pathMatch: 'full'
                    },
                    {
                        path: 'trades',
                        loadComponent: () => import('./features/journal/trade-list/trade-list').then(m => m.TradeListComponent)
                    },
                    {
                        path: 'daily',
                        canActivate: [planGuard('premium')],
                        loadComponent: () => import('./features/journal/daily-journal/daily-journal.component').then(m => m.DailyJournalComponent)
                    }
                ]
            },
            {
                path: 'journal/trade/new',
                loadComponent: () => import('./features/journal/trade-entry/trade-entry')
                    .then(m => m.TradeEntryComponent),
                canActivate: [authGuard]
            },
            {
                path: 'journal/trade/:id/edit',
                loadComponent: () => import('./features/journal/trade-entry/trade-entry')
                    .then(m => m.TradeEntryComponent),
                canActivate: [authGuard]
            },
            {
                path: 'journal/trade/:id',
                loadComponent: () => import('./features/journal/trade-detail/trade-detail')
                    .then(m => m.TradeDetailComponent),
                canActivate: [authGuard]
            },
            {
                path: 'settings',
                canActivate: [planGuard('premium')],
                loadChildren: () => import('./features/integrations/integrations.routes')
                    .then(m => m.INTEGRATION_ROUTES)
            },
        ]
    }
];
