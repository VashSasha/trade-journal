import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, SecurityContext } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideMarkdown, MARKED_OPTIONS, SANITIZE } from 'ngx-markdown';

import { routes } from './app.routes';
import { UserDataService } from './core/services/user-data/user-data.service';
import { provideChunkReloadRecovery } from './core/chunk-reload';
import { markdownOptionsFactory } from './core/utils/markdown-options';

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
    // AI responses and saved reports are untrusted HTML. Task markers use
    // text glyphs so sanitization can remain enabled everywhere.
    provideMarkdown({
      sanitize: { provide: SANITIZE, useValue: SecurityContext.HTML },
      markedOptions: {
        provide: MARKED_OPTIONS,
        useFactory: markdownOptionsFactory,
      },
    }),
    // Construct eagerly (non-blocking) so cloud data loads and the legacy
    // import runs as soon as the session is restored — not on first inject.
    provideAppInitializer(() => {
      inject(UserDataService);
    })
  ]
};
