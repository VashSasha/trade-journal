/**
 * Cloudflare Worker — Discord OAuth token exchange
 *
 * Deploy with: wrangler deploy
 *
 * Environment variables to set in Cloudflare dashboard (wrangler secret put):
 *   DISCORD_CLIENT_ID   — your Discord app's Client ID
 *   DISCORD_GUILD_ID    — your Discord server ID
 *
 * Register this worker's URL in discord.config.ts → webExchangeUrl
 * and add the redirect URI to your Discord app's OAuth2 redirects.
 */

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid JSON body' }, 400);
        }

        const { code, codeVerifier, redirectUri } = body;
        if (!code || !codeVerifier || !redirectUri) {
            return json({ error: 'Missing required fields: code, codeVerifier, redirectUri' }, 400);
        }

        // 1. Exchange code for access token (PKCE — no client_secret needed)
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: env.DISCORD_CLIENT_ID,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier
            }).toString()
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            return json({ error: `Token exchange failed: ${err}` }, 400);
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const expiresIn = tokenData.expires_in;

        // 2. Fetch user info and guild member in parallel
        const [userRes, memberRes] = await Promise.all([
            fetch('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            }),
            fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
        ]);

        if (!userRes.ok) {
            return json({ error: 'Failed to fetch Discord user' }, 500);
        }

        const discordUser = await userRes.json();

        if (memberRes.status === 404) {
            return json({ error: 'You must be a member of the Discord server to use this app.' }, 403);
        }

        let memberRoles = [];
        if (memberRes.ok) {
            const memberData = await memberRes.json();
            memberRoles = memberData.roles || [];
        }

        const sessionExpiry = Date.now() + expiresIn * 1000;

        // Mint a signed session token (HMAC-SHA256) the browser presents to the
        // ai-proxy worker. Shared JWT_SECRET; `sub` = Discord user id.
        const authToken = env.JWT_SECRET
            ? await signJwt({ sub: discordUser.id, exp: Math.floor(sessionExpiry / 1000) }, env.JWT_SECRET)
            : undefined;

        return json({
            id: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name,
            avatar: discordUser.avatar
                ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                : null,
            roles: memberRoles,
            sessionExpiry,
            authToken
        });
    }
};

// ── JWT (HMAC-SHA256) signing ────────────────────────────────────────────────

async function signJwt(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encode = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));
    const data = `${encode(header)}.${encode(payload)}`;

    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return `${data}.${b64url(new Uint8Array(sig))}`;
}

function b64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
