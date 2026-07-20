// stripe-webhook — the ONLY writer of billing state. Stripe calls this after a
// Checkout completes and whenever a subscription changes, so it must be the
// source of truth for both the `billing` table and profiles.billing_plan.
//
// Deploy with `--no-verify-jwt`: Stripe is the caller, not a logged-in user, so
// there's no Supabase JWT. Authenticity is proven instead by verifying Stripe's
// signature against STRIPE_WEBHOOK_SECRET over the RAW request body. An invalid
// or missing signature is rejected (400) before any DB write.
//
// Entitlement rule: while the subscription is active/trialing we set
// profiles.billing_plan = 'premium'; otherwise (canceled / unpaid /
// incomplete_expired / …) we set it to null so the 0007 trigger falls the
// effective plan back to discord_plan / free. We NEVER touch plan_override and
// never write profiles.plan directly.
//
// Secrets (set via `supabase secrets set`, never committed):
//   STRIPE_SECRET_KEY      — Stripe TEST secret key (sk_test_...)
//   STRIPE_WEBHOOK_SECRET  — signing secret for this endpoint (whsec_...)
//   SB_SECRET_KEY          — Supabase secret API key (service-role equivalent)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Admin client: bypasses RLS. The only client that may write `billing` and
// profiles.billing_plan. Never exposed to the browser.
const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
  httpClient: Stripe.createFetchHttpClient(),
});

// Subscription statuses that grant the paid entitlement.
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Reflect a subscription into `billing` (upsert) and flip
 * profiles.billing_plan. `userId` may be null on subscription.* events — we
 * then resolve it from the existing billing row by customer id.
 */
async function applySubscription(
  sub: Stripe.Subscription,
  userIdHint: string | null,
): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  // Resolve the user: prefer the hint (from metadata), else look up by customer.
  let userId = userIdHint ?? (sub.metadata?.user_id ?? null);
  if (!userId) {
    const { data } = await admin
      .from('billing')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    // Nothing to attribute this to — nothing to write. (Stripe still gets a 2xx.)
    console.error('stripe-webhook: could not resolve user for customer', customerId);
    return;
  }

  const priceId = sub.items.data[0]?.price?.id ?? null;
  const periodEnd = sub.items.data[0]?.current_period_end ?? null;
  const isActive = ACTIVE_STATUSES.has(sub.status);

  const { error: billingError } = await admin.from('billing').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (billingError) {
    console.error('stripe-webhook: billing upsert failed', billingError);
    throw billingError;
  }

  // Flip only the billing SOURCE; the 0007 trigger derives the effective plan.
  // active/trialing → premium; anything else → null (fall back to Discord/free).
  const { error: planError } = await admin
    .from('profiles')
    .update({ billing_plan: isActive ? 'premium' : null, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (planError) {
    console.error('stripe-webhook: profiles.billing_plan update failed', planError);
    throw planError;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Verify the Stripe signature over the RAW body. constructEventAsync is
  // required in Deno (the sync variant uses Node crypto). Reject on any failure.
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // 2. Handle the subscription lifecycle. Any DB error → 500 so Stripe retries.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Ignore non-subscription checkouts (none expected, but be safe).
        if (session.mode !== 'subscription' || !session.subscription) break;
        const userId =
          session.client_reference_id ?? (session.metadata?.user_id ?? null);
        const subId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        await applySubscription(sub, userId);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await applySubscription(sub, null);
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops resending.
        break;
    }
  } catch (err) {
    console.error('stripe-webhook: handler error', err);
    return new Response('Handler error', { status: 500 });
  }

  // 3. Always ack quickly after the write.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
