import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, SecurityContext } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideMarkdown, MARKED_OPTIONS, SANITIZE } from 'ngx-markdown';

import { routes } from './app.routes';
import { UserDataService } from './core/services/user-data/user-data.service';
import { provideChunkReloadRecovery } from './core/chunk-reload';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({
      // Lets routerLink fragments (e.g. login → /#pricing) scroll to their target.
      anchorScrolling: 'enabled',
      scrollPositionRestoration: 'enabled'
    })),
    provideHttpClient(),
    // After a deploy, tabs opened pre-deploy request old chunk hashes and get
    // the SPA fallback (text/html) instead — auto-reload once to recover.
    provideChunkReloadRecovery(),
    // App-wide markdown config. gfm:true makes marked render GitHub task
    // lists (`- [ ]` / `- [x]`) as <input type="checkbox" disabled> items.
    // sanitize:NONE is required because Angular's HTML sanitizer strips
    // <input> elements — without it the checkboxes vanish. Safe here: every
    // <markdown> surface renders only trusted AI output from our own Edge
    // Function (never user-supplied HTML); the Quill notes editor is separate.
    provideMarkdown({
      sanitize: { provide: SANITIZE, useValue: SecurityContext.NONE },
      markedOptions: {
        provide: MARKED_OPTIONS,
        useValue: { gfm: true, breaks: false },
      },
    }),
    // Construct eagerly (non-blocking) so cloud data loads and the legacy
    // import runs as soon as the session is restored — not on first inject.
    provideAppInitializer(() => {
      inject(UserDataService);
    })
  ]
};
