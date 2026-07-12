import { Routes } from '@angular/router';

export const INTEGRATION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./settings-page/settings-page.component')
            .then(m => m.SettingsPageComponent)
    },
    {
        path: 'tradovate/callback',
        loadComponent: () => import('./components/tradovate-callback/tradovate-callback.component')
            .then(m => m.TradovateCallbackComponent)
    }
];
