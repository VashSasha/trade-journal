// create-portal-session — opens the Stripe Billing Portal so a subscriber can
// update or cancel their own subscription. Verifies the caller's Supabase JWT,
// looks up THEIR stripe_customer_id (never from the body, so nobody can open
// another user's portal), and returns the hosted portal URL to redirect to.
//
// Secrets (set via `supabase secrets set`, never committed):
//   STRIPE_SECRET_KEY  — Stripe TEST secret key (sk_test_...)
//   SB_SECRET_KEY      — Supabase secret API key (service-role equivalent)
//   APP_ORIGIN         — production web origin (CORS + return URL)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
  httpClient: Stripe.createFetchHttpClient(),
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

  // Verify the caller's Supabase JWT — the customer comes from their own row.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401, cors);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return json({ error: 'Invalid or expired token' }, 401, cors);
  }
  const user = userData.user;

  const { data: billing } = await admin
    .from('billing')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!billing?.stripe_customer_id) {
    return json({ error: 'No billing account for this user' }, 404, cors);
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${APP_ORIGIN}/account`,
    });
    return json({ url: session.url }, 200, cors);
  } catch (err) {
    console.error('portal session create failed:', err);
    return json({ error: 'Failed to create portal session' }, 500, cors);
  }
});
