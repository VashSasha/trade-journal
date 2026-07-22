import { inject, provideEnvironmentInitializer } from '@angular/core';
import { NavigationError, Router } from '@angular/router';

/**
 * Auto-recover from stale-deploy chunk failures.
 *
 * Every production deploy replaces the content-hashed JS chunks. A tab that
 * loaded index.html BEFORE the deploy still requests the old chunk names when
 * it lazily navigates; the CDN no longer has them, its SPA fallback answers
 * with index.html (text/html), and the router surfaces:
 *   "Failed to load module script ... MIME type of text/html"
 * A full reload fetches the current index.html (served no-cache) and fixes it
 * — so do that reload automatically, at most once per navigation target, to
 * avoid a reload loop if the target is genuinely broken.
 */

const RELOADED_KEY = 'tj_chunk_reload';

function isChunkLoadError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError/i.test(message);
}

export function provideChunkReloadRecovery() {
    return provideEnvironmentInitializer(() => {
        const router = inject(Router);
        router.events.subscribe(event => {
            if (!(event instanceof NavigationError) || !isChunkLoadError(event.error)) return;

            // Guard: only one auto-reload per target URL. If the same URL fails
            // again right after a fresh reload, something else is wrong — let
            // the error surface instead of reload-looping.
            const target = event.url;
            let lastReloaded: string | null = null;
            try { lastReloaded = sessionStorage.getItem(RELOADED_KEY); } catch { /* private mode */ }
            if (lastReloaded === target) return;
            try { sessionStorage.setItem(RELOADED_KEY, target); } catch { /* best effort */ }

            // Hard-navigate to the target so the user lands where they were
            // going, with the new deploy's index.html and chunks.
            window.location.assign(target);
        });
    });
}
