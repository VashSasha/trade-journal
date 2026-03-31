import { Routes } from '@angular/router';
import { MainLayoutComponent } from './features/layout/main-layout/main-layout';
import { LoginComponent } from './features/auth/login/login';
import { authGuard } from './core/guards/auth.guard';
import { planGuard } from './core/guards/plan.guard';

export const routes: Routes = [
    {
        path: 'login',
        component: LoginComponent
    },
    {
        path: 'integrations/discord-callback',
        loadComponent: () => import('./features/integrations/discord-callback/discord-callback.component')
            .then(m => m.DiscordCallbackComponent)
    },
    {
        path: 'upgrade',
        canActivate: [authGuard],
        loadComponent: () => import('./features/upgrade/upgrade.component')
            .then(m => m.UpgradeComponent)
    },
    {
        path: '',
        component: MainLayoutComponent,
        canActivate: [authGuard],
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
