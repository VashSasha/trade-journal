# Premium+ rollout

Implementation is local until the migration, Edge Functions, and frontend are deployed.
No Stripe prices, subscriptions, or live Supabase records were changed by this work.

## Access and pricing

| Access | Journal / analytics / broker sync / guardrails | AI | USD monthly | USD annually |
| --- | --- | --- | --- | --- |
| Premium | Yes | No | $24.99 | $249.99 |
| Legacy Lifetime | Same as Premium | No | Not sold | Not sold |
| Premium+ | Yes | Yes | $34.99 | $349.99 |
| Discord community | Includes Premium | No | $79.99 via Whop | — |

Free keeps its existing limited journal/demo access. Premium/Lifetime keep factual
live position updates and browser voice; personalized comments, AI reports,
follow-ups and generated voices require AI access. Existing saved data is retained.
The AI Analyzer route still requires AI access; removing access does not delete its reports.

There is **no grandfathered AI** for Premium or Lifetime. Admin remains an internal
non-purchasable tier with AI, unless explicitly disabled. Plus ranks above Lifetime
so buying Plus works even with a Lifetime Discord role. An explicit `plan_override`
still wins over billing: clear a stale override if that user should follow their subscription.

Existing limits remain: 10 analyses/day and 30 Live Coach AI requests/day, reset at
midnight UTC. Speech and previews share the Coach allowance. Failed pre-output
requests refund; successful or partial output counts. No unlimited-AI promise.

## Stripe setup

1. Create Premium+ recurring prices: **USD 34.99/month** and **USD 349.99/year**.
   Keep existing Premium prices unchanged. Match the mode of your Stripe secret
   key and webhook; test prices are not usable with live keys.
2. Keep `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` pointing at the Premium prices.
   Set `STRIPE_PRICE_PREMIUM_PLUS_MONTHLY` / `STRIPE_PRICE_PREMIUM_PLUS_ANNUAL`
   to the two new `price_...` IDs in Supabase Edge Function secrets.
   Each configured price ID must be unique. Amounts must match the pricing cards.
3. In Stripe Customer Portal settings, enable subscription switching and expose
   the Premium and Premium+ monthly/yearly prices. Choose and test proration and
   downgrade timing deliberately; the app does not configure these for you.
   See [Stripe portal configuration](https://docs.stripe.com/customer-management/configure-portal).
4. Keep the existing signed webhook endpoint and its checkout/subscription events.
   Existing subscribers upgrade through the portal, not a second checkout.
   Past-due/incomplete subscriptions also go to the portal to resolve billing.

Price IDs are allowlisted server-side, not accepted from the browser. An unknown
active price or multi-item subscription makes reconciliation retry rather than
guessing a tier. Resolve configuration errors promptly and resend the event in
Stripe. Keep any prices used by existing journal subscribers mapped correctly;
this first version supports one monthly and one annual price per tier.

## Deploy together

Use a test project first; verify migrations through **0031** exist. Back up before
production rollout. Run from the repository root, **not `discord-exchange/`**.

1. Configure the Stripe prices/secrets and portal above.
2. Run `supabase/migrations/0032_premium_plus.sql` in Supabase SQL Editor.
   It adds `profiles.ai_access_override`, updates plan computation, and replaces
   the entitlement/billing RPC signatures. Safe to rerun; no trading data deleted.
3. Immediately deploy the matching functions below, then deploy the frontend.
   Use one coordinated rollout: old AI code still permits the old tiers, while
   old webhooks cannot call the new billing RPC. Stripe retries failed events.

```bash
npx supabase functions deploy ai-report --project-ref elbcjsewyqptrckdydha
npx supabase functions deploy stripe-webhook --project-ref elbcjsewyqptrckdydha
npx supabase functions deploy create-checkout --project-ref elbcjsewyqptrckdydha
npx supabase functions deploy create-portal-session --project-ref elbcjsewyqptrckdydha
npx supabase functions deploy resolve-plan --project-ref elbcjsewyqptrckdydha
```

`ROLE_ID_PREMIUM_PLUS` is optional, only if you later assign a separate Plus Discord
role. Existing member/lifetime roles do not grant AI. Billing CORS supports the
configured production origin, local development, and this project's dynamic Pages
previews; return URLs stay on `APP_ORIGIN`. Do not disable JWT checks to resolve CORS.

## Individual AI grants

In Supabase Table Editor → `profiles`, find the exact user by `id` and set:

- `ai_access_override = true`: grant AI without changing their base plan.
- `ai_access_override = false`: deny AI, even on Premium+.
- `ai_access_override = NULL`: follow the effective plan (normal default).

Do not edit computed `plan` or add grants to browser-editable metadata. Clients can
only edit their display name, not entitlement fields. The AI endpoint reads the
effective AI capability independently of the UI. A free user with an AI grant
does not gain broker sync or live position monitoring; use Premium/Lifetime + the
grant when those features are also needed. Refresh/reopen the app to reload access.

## Verify before launch

- Premium and Lifetime: journal/analytics/broker sync work; AI endpoint denies
  before quota/provider calls. Saved Cedar selection falls back to browser voice.
- Premium+: all AI entry points work; individual false override disables them.
- Premium/Lifetime + true override: AI works; removing it restores base access.
- Upgrade monthly/yearly through the portal: no duplicate subscription; signed
  webhook updates billing tier. Test downgrade, cancellation, failed payment,
  duplicate events, and an independent Discord/admin grant surviving cancellation.
- Free/demo and cross-user access remain isolated. Reports/trades/accounts survive.
- Confirm all four displayed USD prices equal the corresponding Stripe prices.

Local validation: frontend tests, backend unit tests, Edge Function type checks,
and the disposable Postgres harness (`scripts/test-database.ts`). These do not
replace a Stripe test-mode end-to-end checkout and webhook test.

Prefer a forward fix if rollout fails. Do not restore the old AI endpoint or old
implicit-Premium webhook alone; that would undo the access policy or mismatch the
new RPC. Keep the schema/data intact and retry failed signed billing events after
repairing configuration.
