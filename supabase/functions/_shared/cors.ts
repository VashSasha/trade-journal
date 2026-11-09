// Only our Pages projects, not arbitrary *.pages.dev tenants. One optional
// DNS label covers both branch aliases and immutable deployment hashes.
const PAGES_ORIGIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?(?:nvzn-journal|trade-journal-2go)\.pages\.dev$/;
const LOCAL_ORIGINS = new Set(['http://localhost:4200', 'http://127.0.0.1:4200']);

/** Browser origins only. Authentication/entitlements are enforced separately. */
export function isAllowedAppOrigin(origin: string | null | undefined, appOrigin?: string): origin is string {
    if (!origin || origin === 'null') return false;
    try {
        const url = new URL(origin);
        // Reject credentials, paths, queries, fragments and opaque origins,
        // including a malformed APP_ORIGIN accidentally configured that way.
        if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) return false;
    } catch { return false; }
    return origin === appOrigin || LOCAL_ORIGINS.has(origin) || PAGES_ORIGIN.test(origin);
}

export function appCorsHeaders(req: Request, appOrigin?: string): Record<string, string> {
    const origin = req.headers.get('Origin');
    // Vary also on denied/missing origins so cached responses cannot carry
    // another origin's CORS decision. No wildcard or credential relaxation.
    if (!isAllowedAppOrigin(origin, appOrigin)) return { Vary: 'Origin' };
    return {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}
