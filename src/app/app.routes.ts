import { Routes } from '@angular/router';
import { MainLayoutComponent } from './features/layout/main-layout/main-layout';
import { LoginComponent } from './features/auth/login/login';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
    {
        path: 'login',
        component: LoginComponent
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
                path: 'journal',
                loadComponent: () => import('./features/journal/trade-list/trade-list').then(m => m.TradeListComponent)
            },
            {
                path: 'journal/new',
                loadComponent: () => import('./features/journal/trade-entry/trade-entry')
                    .then(m => m.TradeEntryComponent),
                canActivate: [authGuard]
            },
            {
                path: 'journal/edit/:id',
                loadComponent: () => import('./features/journal/trade-entry/trade-entry')
                    .then(m => m.TradeEntryComponent),
                canActivate: [authGuard]
            },
            {
                path: 'settings',
                loadChildren: () => import('./features/integrations/integrations.routes')
                    .then(m => m.INTEGRATION_ROUTES)
            },
            {
                path: 'journal/:id',
                loadComponent: () => import('./features/journal/trade-detail/trade-detail')
                    .then(m => m.TradeDetailComponent),
                canActivate: [authGuard]
            },
            // More routes will be added here
        ]
    }
];
