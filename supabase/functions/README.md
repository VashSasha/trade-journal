# Edge Functions

## Custom alert sounds

Migration `0022_custom_alert_sounds.sql` creates a private Storage bucket plus
owner-scoped metadata. Files are limited to four fixed cue paths per user,
3 MB per file, approved audio MIME types, and can only be accessed by that
authenticated owner. The client keeps IndexedDB as a playback cache and
automatically migrates sounds created by the earlier browser-only version.

After applying the migration, redeploy account deletion so cloud audio is also
removed when a user permanently deletes their account:

```bash
supabase functions deploy delete-account --project-ref elbcjsewyqptrckdydha
```

No new secret is required.

## market-news

Returns a normalized, newest-first feed of official monetary-policy, inflation,
and employment headlines for signed-in users. It reads the Federal Reserve
monetary-policy RSS feed and the BLS CPI, Employment Situation, and PPI Atom
feeds. Failed sources are reported individually so the client can keep showing
partial results, and both the function and client retain short-lived caches.

```bash
supabase functions deploy market-news --project-ref elbcjsewyqptrckdydha
```

It uses the existing `SB_SECRET_KEY` to validate the caller and `APP_ORIGIN` for
CORS. No new secret or database migration is required. The client treats every
response as untrusted and only opens HTTPS links on the expected official host.

## market-events

Returns a normalized U.S. economic-event schedule for signed-in users. It
combines the official BLS calendar (CPI, NFP, PPI, JOLTS), BEA release schedule
(GDP, PCE, trade), and published Federal Reserve FOMC decision dates. The
function has no third-party data key and returns only public schedule metadata;
the client keeps a last-known cache and its small curated calendar as fallback.

```bash
supabase functions deploy market-events --project-ref elbcjsewyqptrckdydha
```

It uses the existing `SB_SECRET_KEY` to validate the caller and `APP_ORIGIN` for
CORS. No new secret or database migration is required.

## ai-report

Server-side proxy for all AI features (trade analysis, chart image analysis,
market prediction, streaming reports, and short Live Coach comments). The OpenAI API key exists
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
- Live Coach uses a separate 30-comment daily quota and `gpt-4o-mini`, so a
  trading session cannot consume the user's 10 full reports. Only validated,
  identity-free aggregate context is accepted; failed comments fall back to
  the local factual narration and refundable reservations are settled once.
- No automatic upstream retries; first streamed text has a 35-second deadline
  and the overall invocation a 75-second deadline. Cancellation aborts upstream.
- `stream-analysis` requests return Server-Sent Events. OpenAI stream chunks
  are translated into the Anthropic wire shape (`content_block_delta` /
  `message_stop`) the client parser reads. An interrupted stream emits `error`;
  EOF without `message_stop` is also a client error, never an auto-save success.

Apply migrations 0018–0020 and 0025–0027, then follow
[P2 rollout](../../docs/P2-fixes-rollout.md) before deploying this version.

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
| `OPENAI_API_KEY` | OpenAI API key used for completions and optional Coach speech |
| `SB_SECRET_KEY` | Shared with resolve-plan (see below) — validates JWTs, reads plans, writes `ai_usage` |
| `APP_ORIGIN` | Shared with resolve-plan — production web origin allowed for CORS |

### Live Coach natural voices

Live Coach supports the browser voice plus optional AI-generated **Marin** and
**Cedar** voices. Short, personalized entry/exit comments use `gpt-4o-mini` for
text and `gpt-4o-mini-tts` for speech. Size changes and performance guardrails
keep immediate browser narration. These are observations, not trade signals.

From the repository root:

1. Apply `supabase/migrations/0027_live_coach_voice.sql` in the Supabase SQL
   editor. It replaces the preference RPC without deleting user data. Earlier
   migrations, including 0025 and 0026, must already be applied. Do not rerun
   the older migrations over the new RPC.
2. Deploy the updated function:

   ```bash
   npx supabase functions deploy ai-report --project-ref elbcjsewyqptrckdydha
   ```

3. Deploy the frontend normally. In **Settings → Alerts → Live Coach**, enable
   the coach and **Personalized coaching**, choose an AI voice, then click
   **Test voice**. This also unlocks audio playback for that browser.

No new secret, storage bucket, or broker permission is required. The existing
server-only `OPENAI_API_KEY` needs access to the speech model and funded API
billing. See the [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

- AI voice previews use fixed server text, never arbitrary client text. They
  share the coach's 30-successful-comment/UTC-day allowance, separate from full
  reports; failed reservations are refunded subject to the attempt cap.
- Browser speech stays available when AI text or audio fails, times out, or
  reaches its allowance. The settings show fallback status. Browser audio
  permissions still apply; **Test voice** may be needed after opening a fresh
  browser. The 12-second client deadline discards late replies.
- The enabled state, event choices, pace, repeat gap, and selected voice sync
  to the user's account. Pause is local to the current tab. The header offers
  a quick pause/resume button while the coach is enabled.
- The last 10 observations are kept in memory for the current tab only and
  cleared on logout/reload. NVZN does not persist this comment history or its
  generated audio. Only bounded performance context is sent to the AI service;
  no broker credentials or account identifiers are included.
- Keep NVZN open and the broker stream connected. Only the tab owning the
  live stream narrates position events; follower tabs do not duplicate them.
  Reconnect snapshots and paused events are not replayed. Copied position
  changes are grouped before generating a comment, and performance guardrails
  interrupt less important speech.

After deployment, smoke-test a funded paid account in a supported browser:
preview each voice; observe one real position update when otherwise trading;
pause/resume; change size or close before a comment finishes; confirm a second
tab does not repeat it; then reload to verify the voice selection persists.
Test mobile audio activation and the header pause button separately. Do not
place trades solely to test this feature. Automated tests cover mocked broker
and speech responses, not a paid provider call or live broker session.

To disable natural speech, select **Browser voice**. To stop all coaching,
switch **Live Coach** off; no rollback or removal of stored data is needed.

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

Verifies the caller's Discord guild roles and writes `profiles.discord_plan` — one of the
plan SOURCES from which a DB trigger derives the effective `profiles.plan`
(see migrations `0007_plan_sources.sql` and `0020_discord_entitlement_expiry.sql`). It runs with the Supabase secret key,
which exists **only** as a function secret, never in this repo or the client.
For normal renewals it looks up the verified linked Discord id using a
server-held bot token. The user's Discord OAuth token remains a fallback for
deployments that have not configured the bot yet.

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
  DISCORD_BOT_TOKEN=replace_with_the_raw_bot_token \
  ROLE_ID_MEMBER=0000000000000000000 \
  ROLE_ID_LIFETIME=0000000000000000000 \
  APP_ORIGIN=https://nvzn-journal.com
```

| Secret | Purpose |
|---|---|
| `SB_SECRET_KEY` | Supabase secret API key (service-role equivalent) — validates JWTs and performs the privileged `profiles.plan` update |
| `DISCORD_GUILD_ID` | Discord guild whose roles gate the plans |
| `DISCORD_BOT_TOKEN` | Raw token for a bot installed in that guild; enables silent membership renewal and must never reach the browser |
| `ROLE_ID_MEMBER` | Role id mapped to the `premium` plan |
| `ROLE_ID_LIFETIME` | Role id mapped to the `lifetime` plan |
| `APP_ORIGIN` | Production web origin allowed for CORS (localhost:4200 is always allowed) |

Create or reuse the bot belonging to the same Discord application, add it to
`DISCORD_GUILD_ID` with the `bot` OAuth scope, and store the raw token (without
the `Bot ` prefix) as `DISCORD_BOT_TOKEN`. Reading one guild member does not
require Administrator or Manage Roles permission. Never use the OAuth client
secret or a user token in this setting.

### Behavior

- Rejects requests without a valid Supabase JWT (401).
- The bot looks up only the Discord id from the caller's verified Supabase Auth
  identity. When the provider-token fallback is used, it rejects a token whose
  user id does not match that identity (403). Neither path trusts user_metadata
  or a client-supplied profile field.
- Not in the guild / no matching roles → `discord_plan` null.
- Role verification expires after one hour. The client refreshes near expiry
  through the guild bot, including after a page reload, a Google login, or a
  suspended tab. Account settings offers Discord sign-in only as a fallback
  when bot verification is unavailable. No user provider or refresh token is
  newly persisted by the app and no cron job is required.
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
