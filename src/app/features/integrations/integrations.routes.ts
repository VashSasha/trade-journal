import { Routes } from '@angular/router';

export const INTEGRATION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./components/tradovate-settings/tradovate-settings.component')
            .then(m => m.TradovateSettingsComponent)
    },
    {
        path: 'tradovate/callback',
        loadComponent: () => import('./components/tradovate-callback/tradovate-callback.component')
            .then(m => m.TradovateCallbackComponent)
    }
];
