// delete-account — permanently deletes the caller's own auth user. Every
// user-owned table FKs auth.users(id) ON DELETE CASCADE, so removing the auth
// user wipes their profile, trades, journal entries, saved analyses, etc.
//
// Only the account's owner can delete it: we verify the caller's Supabase JWT,
// then delete THAT user id with the service-role admin API. There is no way to
// target another user — the id comes from the verified token, never the body.
//
// Secrets (set via `supabase secrets set`, never committed):
//   SB_SECRET_KEY  — Supabase secret API key (service role equivalent)
//   APP_ORIGIN     — production web origin allowed for CORS

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

// Admin client: bypasses RLS and can call the auth admin API. Never exposed
// to the browser.
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

  // Verify the caller's Supabase JWT — the deleted id comes from here.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401, cors);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return json({ error: 'Invalid or expired token' }, 401, cors);
  }

  // Delete the auth user; user-data tables cascade from auth.users(id).
  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    console.error('deleteUser failed:', deleteError);
    return json({ error: 'Failed to delete account' }, 500, cors);
  }

  return json({ deleted: true }, 200, cors);
});
