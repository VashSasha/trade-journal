/**
 * Cloudflare Worker — Tradovate CORS proxy
 *
 * Tradovate's REST / auth / reports hosts (*.tradovateapi.com) do not send
 * Access-Control-Allow-Origin headers, so a browser blocks any direct call and
 * Angular's HttpClient reports `status: 0 Unknown Error`. (Electron isn't bound
 * by CORS, so the desktop build calls Tradovate directly and never hits this.)
 *
 * This Worker is a generic pass-through: the browser calls
 *   https://<worker>/<tradovate-host>/<path>?<query>
 * and the Worker forwards it server-to-server to
 *   https://<tradovate-host>/<path>?<query>
 * then returns the response with CORS headers added.
 *
 * SSRF guard: only forwards to *.tradovateapi.com hosts.
 *
 * Reserved route (not part of the pass-through):
 *   POST /oauth/token  { code, redirect_uri, environment }
 * Exchanges an OAuth authorization code for an access token, injecting the
 * app's client credentials server-side so they never ship to the browser or
 * the Electron bundle. Set them once with:
 *   wrangler secret put TRADOVATE_CLIENT_ID
 *   wrangler secret put TRADOVATE_CLIENT_SECRET
 *
 * Deploy with: wrangler deploy   (run from this directory)
 *
 * Register this Worker's origin in tradovate.service.ts → tradovateProxyOrigin.
 */

// Cap upstream calls so a slow Tradovate host yields a CORS-tagged 504, not a
// CORS-less Cloudflare edge timeout.
const UPSTREAM_TIMEOUT_MS = 20_000;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
};

// Hop-by-hop / proxy headers that must not be forwarded upstream.
const STRIP_REQUEST_HEADERS = new Set([
    'host', 'origin', 'referer', 'connection',
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker',
    'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip',
]);

export default {
    async fetch(request, env) {
        try {
            return await handle(request, env);
        } catch (e) {
            // Never let an uncaught error become a CORS-less Cloudflare error page —
            // always return a response the browser can read.
            return json({ error: 'proxy_error', detail: String(e) }, 500);
        }
    },
};

async function handle(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        const url = new URL(request.url);

        // Reserved route: OAuth code→token exchange with server-held credentials.
        // Safe to reserve — the pass-through's first path segment is always a
        // *.tradovateapi.com host, never "oauth".
        if (url.pathname === '/oauth/token') {
            return oauthToken(request, env);
        }
        const rest = url.pathname.replace(/^\/+/, ''); // "<host>/<path>"
        if (!rest) {
            return text('Tradovate proxy. Usage: /<tradovate-host>/<path>', 400);
        }

        let target;
        try {
            target = new URL(`https://${rest}${url.search}`);
        } catch {
            return text('Bad target URL', 400);
        }

        // SSRF guard — only Tradovate hosts.
        if (target.hostname !== 'tradovateapi.com' && !target.hostname.endsWith('.tradovateapi.com')) {
            return text('Forbidden host', 403);
        }

        const headers = new Headers();
        for (const [k, v] of request.headers) {
            if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v);
        }

        const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

        const upstream = await boundedFetch(target.toString(), {
            method: request.method,
            headers,
            body: hasBody ? await request.arrayBuffer() : undefined,
            redirect: 'follow',
        });

        return passthrough(upstream);
}

// OAuth code→token exchange. The browser/Electron client sends only
// { code, redirect_uri, environment } — the client credentials are injected
// here from Worker secrets and never leave the server side.
async function oauthToken(request, env) {
    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }
    if (!env.TRADOVATE_CLIENT_ID || !env.TRADOVATE_CLIENT_SECRET) {
        return json({ error: 'OAuth not configured: set TRADOVATE_CLIENT_ID and TRADOVATE_CLIENT_SECRET worker secrets' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { code, redirect_uri, environment } = body || {};
    if (!code || !redirect_uri) {
        return json({ error: 'Missing required fields: code, redirect_uri' }, 400);
    }

    const target = environment === 'live'
        ? 'https://live.tradovateapi.com/auth/oauthtoken'
        : 'https://demo.tradovateapi.com/v1/auth/oauthtoken';

    const upstream = await boundedFetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: env.TRADOVATE_CLIENT_ID,
            client_secret: env.TRADOVATE_CLIENT_SECRET,
            redirect_uri,
        }),
    });

    return passthrough(upstream);
}

// Bound the upstream call. Tradovate's demo hosts can hang on a cold/slow
// first hit; without this the subrequest stalls until Cloudflare returns a
// CORS-less edge timeout page, which the browser reports as a CORS error.
// A bounded fetch lets us return a readable 504 (with CORS) the app can retry.
// On failure returns a ready-to-send JSON error Response (with CORS), which
// passthrough() forwards unchanged.
async function boundedFetch(target, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
        return await fetch(target, { ...init, signal: controller.signal });
    } catch (e) {
        const aborted = e && e.name === 'AbortError';
        return json(
            { error: aborted ? 'Upstream timeout' : 'Upstream fetch failed', detail: String(e) },
            aborted ? 504 : 502,
        );
    } finally {
        clearTimeout(timeout);
    }
}

// Pass the upstream response through verbatim, plus CORS.
// Drop content-encoding/length — the runtime already decoded the body,
// so the original values would no longer match.
function passthrough(upstream) {
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('content-encoding');
    respHeaders.delete('content-length');
    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
    });
}

function text(body, status = 200) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...CORS } });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}
