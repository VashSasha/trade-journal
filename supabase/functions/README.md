# Edge Functions

## ai-report

Server-side proxy for all AI features (trade analysis, chart image analysis,
market prediction, streaming report generation). The OpenAI API key exists
**only** as a function secret — never in the repo or the client. The function:

- Rejects requests without a valid Supabase JWT (401).
- Requires a live `premium` or `lifetime` entitlement via `effective_user_plan()`;
  both plans have the same AI features (403 otherwise).
- Validates input before reserving quota: max 4 MiB JSON, 24 messages, 80,000
  text characters, 2 embedded images, 1–2000 output tokens for streaming.
- Atomically reserves up to 10 analyses/day (UTC) with `reserve_ai_request()`.
  `finish_ai_request()` refunds failures before output exactly once. Partial or
  cancelled responses with generated text count. At most one pending reservation
  younger than two minutes and 30 reserved attempts/day prevent retry abuse.
- No automatic upstream retries; first streamed text has a 35-second deadline
  and the overall invocation a 75-second deadline. Cancellation aborts upstream.
- `stream-analysis` requests return Server-Sent Events. OpenAI stream chunks
  are translated into the Anthropic wire shape (`content_block_delta` /
  `message_stop`) the client parser reads. An interrupted stream emits `error`;
  EOF without `message_stop` is also a client error, never an auto-save success.

Apply migrations 0018–0020 and follow [P2 rollout](../../docs/P2-fixes-rollout.md)
before deploying this version.

### Deploy

```bash
supabase functions deploy ai-report --project-ref elbcjsewyqptrckdydha
```

### Secrets

```bash
supabase secrets set \
  OPENAI_API_KEY=sk-...
```

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key used for every completion |
| `SB_SECRET_KEY` | Shared with resolve-plan (see below) — validates JWTs, reads plans, writes `ai_usage` |
| `APP_ORIGIN` | Shared with resolve-plan — production web origin allowed for CORS |

## Dashboard prerequisites (account linking + Google sign-in)

The Account page's account-linking and the "Continue with Google" button need
two one-time settings in the Supabase dashboard (not code):

1. **Authentication → Providers → Google** — enable it and set the OAuth client
   id/secret. (Discord is already enabled.) Apple is out of scope for now.
2. **Authentication → Settings → "Allow manual linking"** — enable it, so a
   signed-in user can bind additional identities via `linkIdentity()` instead of
   creating a separate account.

Without (1), `linkIdentity({ provider: 'google' })` / Google login fail; without
(2), `linkIdentity()` is rejected server-side.

## resolve-plan

Verifies the caller's Discord guild roles (using the Discord provider token
from their own OAuth session) and writes `profiles.discord_plan` — one of the
plan SOURCES from which a DB trigger derives the effective `profiles.plan`
(see migrations `0007_plan_sources.sql` and `0020_discord_entitlement_expiry.sql`). It runs with the Supabase secret key,
which exists **only** as a function secret, never in this repo or the client.

Also supports a **clear** request (`{ "clear": true }`, no provider token):
after a user unlinks Discord, this nulls `discord_plan` / `discord_id` so the
trigger drops any Discord-derived access. It's rejected (409) if a Discord
identity is still linked, and can only ever lower the caller's own plan.

### Deploy

```bash
supabase functions deploy resolve-plan --project-ref elbcjsewyqptrckdydha
```

### Secrets

Set every secret before first use (placeholder values shown — substitute
real ones locally, do not commit them anywhere):

```bash
supabase secrets set \
  SB_SECRET_KEY=sb_secret_... \
  DISCORD_GUILD_ID=0000000000000000000 \
  ROLE_ID_MEMBER=0000000000000000000 \
  ROLE_ID_LIFETIME=0000000000000000000 \
  APP_ORIGIN=https://nvzn-journal.com
```

| Secret | Purpose |
|---|---|
| `SB_SECRET_KEY` | Supabase secret API key (service-role equivalent) — validates JWTs and performs the privileged `profiles.plan` update |
| `DISCORD_GUILD_ID` | Discord guild whose roles gate the plans |
| `ROLE_ID_MEMBER` | Role id mapped to the `premium` plan |
| `ROLE_ID_LIFETIME` | Role id mapped to the `lifetime` plan |
| `APP_ORIGIN` | Production web origin allowed for CORS (localhost:4200 is always allowed) |

### Behavior

- Rejects requests without a valid Supabase JWT (401).
- Rejects if the Discord token's user id doesn't match the caller's linked
  identity returned by verified Supabase Auth (403). Never trusts user_metadata
  or a client-supplied profile field. Checks `/users/@me` even before a guild 404.
- Not in the guild / no matching roles → `discord_plan` null.
- Role verification expires after one hour. The client refreshes near expiry
  using the provider token when available; Account settings offers Discord
  sign-in again when that credential is missing/expired. No additional token
  storage, bot credentials, cron jobs, or production configuration is created.
- Stored `profiles.plan` is a snapshot, not an authorization oracle. Clients use
  `get_my_entitlements()` and AI uses `effective_user_plan(user_id)`, which also
  checks that the Discord identity is still linked at read time.
- Returns `{ "plan": ... }`. This function does not change manually managed beta access.

## delete-account

Permanently deletes the **caller's own** auth user via the service-role admin
API. Every user-owned table FKs `auth.users(id) ON DELETE CASCADE`, so this
wipes their profile, trades, journal entries, saved analyses, etc. The deleted
id comes from the verified JWT — never the request body — so it can't target
another user. The client requires a typed confirmation before invoking it.

### Deploy

```bash
supabase functions deploy delete-account --project-ref elbcjsewyqptrckdydha
```

### Secrets

```bash
supabase secrets set \
  SB_SECRET_KEY=sb_secret_... \
  APP_ORIGIN=https://nvzn-journal.com
```

| Secret | Purpose |
|---|---|
| `SB_SECRET_KEY` | Supabase secret API key (service-role equivalent) — validates the JWT and deletes the auth user |
| `APP_ORIGIN` | Production web origin allowed for CORS (localhost:4200 is always allowed) |

### Behavior

- Rejects requests without a valid Supabase JWT (401).
- Deletes the token's own user id; cascades remove all their data.
- Returns `{ "deleted": true }`.

## Stripe billing (Phase 3)

Three functions power the journal-only subscription (the `premium` tier). They
run against Stripe **TEST mode** and use the Stripe SDK via `npm:stripe`, pinned
to a fixed `apiVersion`. The subscription entitlement is written **only** by the
webhook: it sets `profiles.billing_plan = 'premium'` while a subscription is
active/trialing and back to `null` otherwise, then the `0007` trigger derives
the effective `profiles.plan`. It never touches `plan_override` and never writes
`plan` directly. Billing state also lives in the `billing` table (see migration
`0009_billing.sql`) — service-role writes only, owners can SELECT their own row.

### create-checkout

Verifies the caller's JWT, maps `{ interval: 'monthly' | 'annual' }` to a
server-side Stripe price id (amounts are never client-supplied), reuses/creates
the user's Stripe customer, and returns a Checkout Session `{ url }`.

### stripe-webhook

Stripe's callback — **deploy with `--no-verify-jwt`** (the caller is Stripe, not
a logged-in user). Authenticity comes from verifying the Stripe signature over
the raw body with `constructEventAsync`; invalid signatures are rejected (400).
Handles `checkout.session.completed`, `customer.subscription.updated`, and
`customer.subscription.deleted`; upserts the `billing` row and flips
`profiles.billing_plan` via the service-role client.

### create-portal-session

Verifies the caller's JWT, looks up their `stripe_customer_id`, and returns a
Stripe Billing Portal `{ url }` (return_url `${APP_ORIGIN}/account`) so users can
update or cancel their own subscription.

### Deploy

```bash
supabase functions deploy create-checkout --project-ref elbcjsewyqptrckdydha
supabase functions deploy create-portal-session --project-ref elbcjsewyqptrckdydha
# Webhook is unauthenticated (Stripe signs it) — skip JWT verification:
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref elbcjsewyqptrckdydha
```

Then, in the Stripe dashboard, add a webhook endpoint pointing at the deployed
`stripe-webhook` URL, subscribed to `checkout.session.completed`,
`customer.subscription.updated`, and `customer.subscription.deleted`. Copy its
signing secret into `STRIPE_WEBHOOK_SECRET`.

### Secrets

Placeholder values shown — substitute your real TEST-mode values locally, never
commit them:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_MONTHLY=price_... \
  STRIPE_PRICE_ANNUAL=price_...
```

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe TEST secret key — every Stripe API call (all three functions) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint — verifies Stripe's signature (`stripe-webhook`) |
| `STRIPE_PRICE_MONTHLY` | Stripe price id for the monthly plan (`create-checkout`) |
| `STRIPE_PRICE_ANNUAL` | Stripe price id for the annual plan (`create-checkout`) |
| `SB_SECRET_KEY` | Shared — validates JWTs and performs service-role writes to `billing` / `profiles` |
| `APP_ORIGIN` | Shared — CORS + Checkout success/cancel and portal return URLs (localhost:4200 always allowed) |
