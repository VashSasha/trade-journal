// create-checkout — starts a Stripe Checkout Session for the journal-only
// subscription (the 'premium' tier). Verifies the caller's Supabase JWT, maps
// the requested billing interval to a server-side Stripe price id (amounts are
// NEVER taken from the client), reuses or creates the user's Stripe customer,
// and returns the hosted Checkout URL for the browser to redirect to.
//
// The actual entitlement flip (profiles.billing_plan = 'premium') happens later
// in stripe-webhook when Stripe confirms the subscription — not here.
//
// Secrets (set via `supabase secrets set`, never committed):
//   STRIPE_SECRET_KEY     — Stripe TEST secret key (sk_test_...)
//   STRIPE_PRICE_MONTHLY  — Stripe price id for the monthly plan
//   STRIPE_PRICE_ANNUAL   — Stripe price id for the annual plan
//   SB_SECRET_KEY         — Supabase secret API key (service-role equivalent)
//   APP_ORIGIN            — production web origin (CORS + success/cancel URLs)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_PRICE_MONTHLY = Deno.env.get('STRIPE_PRICE_MONTHLY') ?? '';
const STRIPE_PRICE_ANNUAL = Deno.env.get('STRIPE_PRICE_ANNUAL') ?? '';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

// Admin client: bypasses RLS. Validates the caller's JWT and reads/writes the
// billing row. Never exposed to the browser.
const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Pin the API version so Stripe's wire shape can't shift under us. Deno's fetch
// is used explicitly (Stripe's default Node http client isn't available).
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

  // 1. Verify the caller's Supabase JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401, cors);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return json({ error: 'Invalid or expired token' }, 401, cors);
  }
  const user = userData.user;

  // 2. Map the requested interval → a server-side price id. The client only
  // ever names an interval; the amount lives in Stripe, never in the request.
  let body: { interval?: string } = {};
  try {
    body = await req.json();
  } catch {
    // fall through — validated below
  }
  const priceId =
    body.interval === 'monthly' ? STRIPE_PRICE_MONTHLY :
    body.interval === 'annual' ? STRIPE_PRICE_ANNUAL :
    '';
  if (!priceId) {
    return json({ error: 'interval must be "monthly" or "annual"' }, 400, cors);
  }

  // 3. Reuse the user's Stripe customer, or create one and store its id. We
  // write only stripe_customer_id here; the subscription fields are filled in
  // by the webhook once Checkout completes.
  const { data: existing } = await admin
    .from('billing')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    const { error: upsertError } = await admin
      .from('billing')
      .upsert(
        { user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (upsertError) {
      return json({ error: 'Failed to store customer' }, 500, cors);
    }
  }

  // 4. Create the Checkout Session. client_reference_id + metadata.user_id let
  // the webhook resolve the user; success/cancel return to /account.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
      success_url: `${APP_ORIGIN}/account?checkout=success`,
      cancel_url: `${APP_ORIGIN}/account?checkout=cancel`,
    });
    return json({ url: session.url }, 200, cors);
  } catch (err) {
    console.error('checkout session create failed:', err);
    return json({ error: 'Failed to create checkout session' }, 500, cors);
  }
});
