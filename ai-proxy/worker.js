/**
 * Cloudflare Worker — Anthropic key store + AI proxy
 *
 * Each user's Anthropic API key is stored ENCRYPTED in KV, keyed to their
 * authenticated Discord identity, and never returned to the browser. The worker
 * injects the key when proxying calls to api.anthropic.com, so the key never
 * persists client-side.
 *
 * Auth: every request must carry `Authorization: Bearer <jwt>` where the JWT is
 * the session token minted by the discord-exchange worker (HMAC-SHA256, shared
 * JWT_SECRET). `sub` = Discord user id.
 *
 * Routes:
 *   POST   /key          { apiKey }      -> store (AES-GCM encrypted) in KV
 *   DELETE /key                          -> remove the caller's key
 *   GET    /key/status                   -> { hasKey: boolean }   (never the key)
 *   POST   /v1/messages   <anthropic body> -> proxy to Anthropic, streams back
 *
 * Bindings/secrets (wrangler):
 *   KV namespace  API_KEYS
 *   secret        JWT_SECRET      (same value as discord-exchange)
 *   secret        KEY_ENC_SECRET  (AES-GCM key material for at-rest encryption)
 *
 * Deploy: wrangler deploy   (from this directory)
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        // ── Authenticate ────────────────────────────────────────────────────
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        const payload = token ? await verifyJwt(token, env.JWT_SECRET) : null;
        if (!payload || !payload.sub) {
            return json({ error: 'unauthorized' }, 401);
        }
        const kvKey = `apikey:${payload.sub}`;

        // ── Routes ──────────────────────────────────────────────────────────
        if (path === '/key' && request.method === 'POST') {
            let body;
            try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
            const apiKey = (body?.apiKey || '').trim();
            if (!apiKey) return json({ error: 'missing_api_key' }, 400);
            const enc = await encrypt(apiKey, env.KEY_ENC_SECRET);
            await env.API_KEYS.put(kvKey, enc);
            return json({ ok: true });
        }

        if (path === '/key' && request.method === 'DELETE') {
            await env.API_KEYS.delete(kvKey);
            return json({ ok: true });
        }

        if (path === '/key/status' && request.method === 'GET') {
            const enc = await env.API_KEYS.get(kvKey);
            return json({ hasKey: !!enc });
        }

        if (path === '/v1/messages' && request.method === 'POST') {
            const enc = await env.API_KEYS.get(kvKey);
            if (!enc) return json({ error: 'no_key' }, 400);
            const apiKey = await decrypt(enc, env.KEY_ENC_SECRET);

            const upstream = await fetch(ANTHROPIC_URL, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
                },
                body: await request.text(),
            });

            // Stream the response (SSE for stream:true) straight back, plus CORS.
            const headers = new Headers(CORS);
            const ct = upstream.headers.get('content-type');
            if (ct) headers.set('content-type', ct);
            return new Response(upstream.body, { status: upstream.status, headers });
        }

        return json({ error: 'not_found' }, 404);
    },
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

// ── JWT (HMAC-SHA256) verification ──────────────────────────────────────────

async function verifyJwt(token, secret) {
    if (!secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
        'HMAC', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`)
    );
    if (!valid) return null;

    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))); }
    catch { return null; }
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
}

// ── AES-GCM encryption (key derived from KEY_ENC_SECRET via SHA-256) ─────────

async function aesKey(secret) {
    const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(plaintext, secret) {
    const key = await aesKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    return b64encode(combined);
}

async function decrypt(b64, secret) {
    const key = await aesKey(secret);
    const combined = b64decode(b64);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
}

// ── base64 helpers ───────────────────────────────────────────────────────────

function b64encode(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function b64decode(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function b64urlToBytes(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    return b64decode(b64);
}
