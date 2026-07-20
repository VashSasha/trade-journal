// resolve-plan — verifies the caller's Discord guild roles and writes
// profiles.discord_plan (one of several plan SOURCES). The effective
// profiles.plan is derived by a DB trigger from discord_plan / billing_plan /
// plan_override, so this function never writes plan directly and can't clobber
// a paid billing_plan. Clients have no insert/update RLS policies on profiles.
//
// Secrets (set via `supabase secrets set`, never committed):
//   SB_SECRET_KEY     — Supabase secret API key (service role equivalent)
//   DISCORD_GUILD_ID  — guild whose roles gate the plans
//   ROLE_ID_MEMBER    — Discord role id → 'premium'
//   ROLE_ID_LIFETIME  — Discord role id → 'lifetime'
//   BETA_ROLE_ID      — Discord role id that grants closed-beta access.
//                       Optional: when unset/empty every guild member is
//                       granted access (kill switch — unset the secret to
//                       open the app without a re-deployment).
//   APP_ORIGIN        — production web origin allowed for CORS

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const DISCORD_GUILD_ID = Deno.env.get('DISCORD_GUILD_ID')!;
const ROLE_ID_MEMBER = Deno.env.get('ROLE_ID_MEMBER') ?? '';
const ROLE_ID_LIFETIME = Deno.env.get('ROLE_ID_LIFETIME') ?? '';
const BETA_ROLE_ID = Deno.env.get('BETA_ROLE_ID') ?? '';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

// Admin client: bypasses RLS. Used to validate the caller's JWT and to
// perform the privileged plan update. Never exposed to the browser.
const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
  auth: {persistSession: false, autoRefreshToken: false},
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
    headers: {...cors, 'Content-Type': 'application/json'},
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: cors});
  }
  if (req.method !== 'POST') {
    return json({error: 'Method not allowed'}, 405, cors);
  }

  // 1. Verify the caller's Supabase JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({error: 'Missing Authorization header'}, 401, cors);

  const {data: userData, error: userError} = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return json({error: 'Invalid or expired token'}, 401, cors);
  }
  const user = userData.user;

  // 2. Read the request body once (provider_token, or a clear request).
  let body: {provider_token?: string; clear?: boolean} = {};
  try {
    body = await req.json();
  } catch {
    // fall through — validated below
  }

  // 2a. Clear path (post-unlink): with no Discord identity left on the account,
  // null out the Discord plan SOURCE so the DB trigger drops any Discord-derived
  // access. This can only LOWER the caller's own plan, so it needs no provider
  // token — just a verified JWT and the absence of a Discord identity.
  if (body?.clear === true) {
    const stillLinked = (user.identities ?? []).some((i) => i.provider === 'discord');
    if (stillLinked) {
      return json({error: 'Discord is still linked to this account'}, 409, cors);
    }
    const {data: cleared, error: clearError} = await admin
      .from('profiles')
      .update({discord_plan: null, discord_id: null, updated_at: new Date().toISOString()})
      .eq('id', user.id)
      .select('plan, beta_access')
      .single();
    if (clearError || !cleared) {
      return json({error: 'Failed to clear Discord plan'}, 500, cors);
    }
    return json({plan: cleared.plan, beta_access: cleared.beta_access}, 200, cors);
  }

  const providerToken = body?.provider_token;
  if (!providerToken || typeof providerToken !== 'string') {
    return json({error: 'provider_token is required'}, 400, cors);
  }

  // 3. The caller's canonical Discord id, set by the signup trigger.
  const {data: profile, error: profileError} = await admin
    .from('profiles')
    .select('discord_id')
    .eq('id', user.id)
    .single();
  if (profileError) {
    return json({error: 'Profile not found'}, 404, cors);
  }
  const expectedDiscordId: string | null =
    profile.discord_id ?? (user.user_metadata?.['provider_id'] as string | undefined) ?? null;
  if (!expectedDiscordId) {
    return json({error: 'No Discord identity linked to this account'}, 400, cors);
  }

  // 4. Ask Discord for the caller's guild membership using THEIR token.
  const memberRes = await fetch(
    `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
    {headers: {Authorization: `Bearer ${providerToken}`}},
  );

  // The Discord-derived plan source. null (not 'free') when the user has no
  // qualifying role or isn't a member, so it never suppresses a paid
  // billing_plan in the DB's effective-plan computation.
  let discordPlan: 'premium' | 'lifetime' | null = null;

  // Kill switch: with no BETA_ROLE_ID configured the gate is open — every
  // authenticated Discord user (member or not) is granted beta access.
  let betaAccess = BETA_ROLE_ID === '';

  if (memberRes.ok) {
    const member = await memberRes.json();

    // Token-substitution defense: the token must belong to the same
    // Discord account that this Supabase user signed in with.
    if (member.user?.id !== expectedDiscordId) {
      return json({error: 'Discord identity mismatch'}, 403, cors);
    }

    const roles: string[] = Array.isArray(member.roles) ? member.roles : [];
    if (ROLE_ID_LIFETIME && roles.includes(ROLE_ID_LIFETIME)) discordPlan = 'lifetime';
    else if (ROLE_ID_MEMBER && roles.includes(ROLE_ID_MEMBER)) discordPlan = 'premium';
    // else: member without a paid role → discordPlan stays null.

    // Beta gate: when a role id is configured, access requires that role.
    if (BETA_ROLE_ID) betaAccess = roles.includes(BETA_ROLE_ID);
  } else if (memberRes.status === 404) {
    // Not a member of the guild → no Discord-derived plan, and no beta role
    // → no access (unless the kill switch above already opened the gate).
    discordPlan = null;
  } else if (memberRes.status === 401 || memberRes.status === 403) {
    return json({error: 'Discord token rejected'}, 401, cors);
  } else {
    return json({error: `Discord API error (${memberRes.status})`}, 502, cors);
  }

  // 5. Privileged write — the secret-key client bypasses RLS by design here.
  // We reach this only for callers with a verified Discord identity, so we
  // never touch beta_access on manually-managed email/password rows (those
  // have discord_id null and never invoke this function). We write the
  // Discord plan SOURCE and let the DB trigger derive the effective plan;
  // reading `plan` back returns that computed value for the client.
  const {data: updated, error: updateError} = await admin
    .from('profiles')
    .update({
      discord_plan: discordPlan,
      beta_access: betaAccess,
      discord_id: expectedDiscordId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('plan, beta_access')
    .single();
  if (updateError || !updated) {
    return json({error: 'Failed to update plan'}, 500, cors);
  }

  return json({plan: updated.plan, beta_access: updated.beta_access}, 200, cors);
});
