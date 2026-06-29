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
 * Deploy with: wrangler deploy   (run from this directory)
 * No secrets required.
 *
 * Register this Worker's origin in tradovate.service.ts → tradovateProxyOrigin.
 */

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
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        const url = new URL(request.url);
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

        let upstream;
        try {
            upstream = await fetch(target.toString(), {
                method: request.method,
                headers,
                body: hasBody ? await request.arrayBuffer() : undefined,
                redirect: 'follow',
            });
        } catch (e) {
            return json({ error: 'Upstream fetch failed', detail: String(e) }, 502);
        }

        // Pass the upstream response through verbatim, plus CORS.
        // Drop content-encoding/length — the runtime already decoded the body,
        // so the original values would no longer match.
        const respHeaders = new Headers(upstream.headers);
        respHeaders.delete('content-encoding');
        respHeaders.delete('content-length');
        respHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: respHeaders,
        });
    },
};

function text(body, status = 200) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...CORS } });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}
