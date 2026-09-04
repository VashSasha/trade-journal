// Verifies a linked Discord identity and grants a renewable one-hour role lease.
// Only the Discord source changes; billing and admin overrides remain independent.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { readJson, RequestError } from '../_shared/request-body.ts';
import { discordIdentity, discordRoles } from '../_shared/discord-identity.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) }) },
});
const origins = new Set(['http://localhost:4200', Deno.env.get('APP_ORIGIN') ?? ''].filter(Boolean));

Deno.serve(async req => {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = origin && origins.has(origin) ? {
        'Access-Control-Allow-Origin': origin, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    } : {};
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
        const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        if (!jwt) return json({ error: 'Missing Authorization header' }, 401);
        const { data, error } = await admin.auth.getUser(jwt);
        if (error || !data.user) return json({ error: 'Invalid or expired token' }, 401);
        const user = data.user;
        const body = await readJson(req, 8192) as { provider_token?: unknown; clear?: boolean } | null;
        const id = discordIdentity(user);
        let plan: 'premium' | 'lifetime' | null = null;
        let expires: string | null = null;
        if (body?.clear === true) {
            if (id) return json({ error: 'Discord is still linked to this account' }, 409);
        } else {
            if (!id) return json({ error: 'No Discord identity linked to this account' }, 400);
            const token = body?.provider_token;
            if (typeof token !== 'string' || !token.length || token.length > 4096) {
                return json({ error: 'A Discord provider token is required' }, 400);
            }
            const guild = Deno.env.get('DISCORD_GUILD_ID') ?? '';
            if (!/^\d{15,22}$/.test(guild)) return json({ error: 'Discord membership verification is not configured' }, 503);
            const roles = await discordRoles(token, id, guild,
                AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]));
            const lifetime = Deno.env.get('ROLE_ID_LIFETIME');
            const premium = Deno.env.get('ROLE_ID_MEMBER');
            if (lifetime && roles.includes(lifetime)) plan = 'lifetime';
            else if (premium && roles.includes(premium)) plan = 'premium';
            expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        }
        // Check again after network I/O: identity may have been unlinked while
        // Discord was responding. The DB live entitlement check also enforces it.
        const fresh = await admin.auth.getUser(jwt);
        if (fresh.error || !fresh.data.user || discordIdentity(fresh.data.user) !== id) {
            return json({ error: 'Your linked identity changed. Please try again.' }, 409);
        }
        const result = await admin.from('profiles').update({
            discord_id: id, discord_plan: plan, discord_plan_expires_at: expires,
            updated_at: new Date().toISOString(),
        }).eq('id', user.id).select('plan').single();
        if (result.error || !result.data) return json({ error: 'Failed to update membership' }, 500);
        return json({ plan: result.data.plan });
    } catch (error) {
        const status = error instanceof RequestError ? error.status : 502;
        return json({ error: error instanceof RequestError ? error.message : 'Membership verification timed out or failed. Please try again.' }, status);
    }
});
