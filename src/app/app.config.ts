import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { UserDataService } from './core/services/user-data/user-data.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({
      // Lets routerLink fragments (e.g. login → /#pricing) scroll to their target.
      anchorScrolling: 'enabled',
      scrollPositionRestoration: 'enabled'
    })),
    provideHttpClient(),
    // Construct eagerly (non-blocking) so cloud data loads and the legacy
    // import runs as soon as the session is restored — not on first inject.
    provideAppInitializer(() => {
      inject(UserDataService);
    })
  ]
};
