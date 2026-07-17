// resolve-plan — verifies the caller's Discord guild roles and writes
// profiles.plan. This is the ONLY writer of plan; clients have no
// insert/update RLS policies on profiles.
//
// Secrets (set via `supabase secrets set`, never committed):
//   SB_SECRET_KEY     — Supabase secret API key (service role equivalent)
//   DISCORD_GUILD_ID  — guild whose roles gate the plans
//   ROLE_ID_MEMBER    — Discord role id → 'premium'
//   ROLE_ID_LIFETIME  — Discord role id → 'lifetime'
//   APP_ORIGIN        — production web origin allowed for CORS

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const DISCORD_GUILD_ID = Deno.env.get('DISCORD_GUILD_ID')!;
const ROLE_ID_MEMBER = Deno.env.get('ROLE_ID_MEMBER') ?? '';
const ROLE_ID_LIFETIME = Deno.env.get('ROLE_ID_LIFETIME') ?? '';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

// Admin client: bypasses RLS. Used to validate the caller's JWT and to
// perform the privileged plan update. Never exposed to the browser.
const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(origin: string | null): Record<string, string> {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
    };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'));

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, cors);
    }

    // 1. Verify the caller's Supabase JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Missing Authorization header' }, 401, cors);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) {
        return json({ error: 'Invalid or expired token' }, 401, cors);
    }
    const user = userData.user;

    // 2. Read the Discord provider token from the body.
    let providerToken: string | undefined;
    try {
        const body = await req.json();
        providerToken = body?.provider_token;
    } catch {
        // fall through to the check below
    }
    if (!providerToken || typeof providerToken !== 'string') {
        return json({ error: 'provider_token is required' }, 400, cors);
    }

    // 3. The caller's canonical Discord id, set by the signup trigger.
    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('discord_id')
        .eq('id', user.id)
        .single();
    if (profileError) {
        return json({ error: 'Profile not found' }, 404, cors);
    }
    const expectedDiscordId: string | null =
        profile.discord_id ?? (user.user_metadata?.['provider_id'] as string | undefined) ?? null;
    if (!expectedDiscordId) {
        return json({ error: 'No Discord identity linked to this account' }, 400, cors);
    }

    // 4. Ask Discord for the caller's guild membership using THEIR token.
    const memberRes = await fetch(
        `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${providerToken}` } },
    );

    let plan: 'free' | 'premium' | 'lifetime' = 'free';

    if (memberRes.ok) {
        const member = await memberRes.json();

        // Token-substitution defense: the token must belong to the same
        // Discord account that this Supabase user signed in with.
        if (member.user?.id !== expectedDiscordId) {
            return json({ error: 'Discord identity mismatch' }, 403, cors);
        }

        const roles: string[] = Array.isArray(member.roles) ? member.roles : [];
        if (ROLE_ID_LIFETIME && roles.includes(ROLE_ID_LIFETIME)) plan = 'lifetime';
        else if (ROLE_ID_MEMBER && roles.includes(ROLE_ID_MEMBER)) plan = 'premium';
    } else if (memberRes.status === 404) {
        // Not a member of the guild → free.
        plan = 'free';
    } else if (memberRes.status === 401 || memberRes.status === 403) {
        return json({ error: 'Discord token rejected' }, 401, cors);
    } else {
        return json({ error: `Discord API error (${memberRes.status})` }, 502, cors);
    }

    // 5. Privileged write — the secret-key client bypasses RLS by design here.
    const { error: updateError } = await admin
        .from('profiles')
        .update({ plan, discord_id: expectedDiscordId, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    if (updateError) {
        return json({ error: 'Failed to update plan' }, 500, cors);
    }

    return json({ plan }, 200, cors);
});
