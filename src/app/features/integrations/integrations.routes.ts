import { Routes } from '@angular/router';

export const INTEGRATION_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./components/tradovate-settings/tradovate-settings.component')
            .then(m => m.TradovateSettingsComponent)
    }
];
