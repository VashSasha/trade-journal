# P2 rollout

These changes are local until you apply the migrations and deploy. Nothing in
this rollout deletes trading accounts, connections, trades, or their balances.

## Changes

- Removed manual account Retire/Restore controls from settings and the expired
  connection banner. Broker `active` status remains; disconnected and disabled
  accounts stay selectable in historical views. Existing false flags are not
  bulk-reset: the next successful broker account fetch supplies current status.
- Premium and lifetime share AI access, including the legacy `hasApiKey` helper
  and route guards. The helper does not expose an actual API key.
- Goals are owner-scoped Supabase rows with RLS and the existing durable outbox.
  Progress is derived from that owner's trades, including the last evening of
  the period. Yearly P&L goals use the year. Edits fail visibly if local queuing
  fails, and pending cloud saves use the existing sync notice.
- The old `trade_journal_goals` browser key is retained but not auto-imported:
  it has no trustworthy owner. Recover it only after confirming who created it.
- Connecting waits for account discovery before the first import; duplicate
  connection submissions are ignored while running. Report format errors,
  timeouts, and failed final saves do not advance the local sync checkpoint.
  An unknown/malformed report must be retried or its parser updated, not treated
  as no trades. The unsafe today-only fallback for historical requests is gone.
- AI input is bounded and validated before quota; failed pre-output attempts
  refund exactly once. Generated partial/cancelled output still counts. Server
  deadlines and explicit SSE errors prevent hanging/successful incomplete reports.
- Discord IDs come from verified Auth identities, not editable user metadata.
  Discord role grants renew for one hour. Expiry or unlinking removes that
  source from live authorization; billing and `plan_override` remain independent.
  A failed Discord request never extends a lease. Provider tokens are not
  newly persisted anywhere. Members may need to sign in with Discord again.
- Removed the unreachable OAuth-placeholder branch in broker settings. This is
  **not** a full Tradovate OAuth rollout; the screen still uses direct broker
  authentication. OAuth needs provider configuration and a separately tested flow.

## Apply in order

Prerequisite: P1 migrations through **0017** have been applied. Use a backup and
test environment first. Run each migration once, in this order:

1. `0018_user_goals.sql` — new owner-scoped goals table.
2. `0019_ai_request_reservations.sql` — private reservation ledger and quota RPCs;
   existing `ai_usage` counts remain intact.
3. `0020_discord_entitlement_expiry.sql` — role-expiry column, trusted identity
   backfill, live entitlement functions, and safer signup hook. Existing Discord
   sources get a one-hour transition only when they match a linked identity.

Deploy the two functions and frontend together after migrations. Existing secrets
are reused; do not paste secrets into source, migration files, or chat.

```bash
npx supabase functions deploy resolve-plan --project-ref elbcjsewyqptrckdydha
npx supabase functions deploy ai-report --project-ref elbcjsewyqptrckdydha
```

Then deploy the web app through the normal release process. If shipping Electron,
publish an updated client too: old clients do not understand SSE error events or
live entitlement expiry. Avoid leaving old functions paired with the new schema
or old clients after the one-hour transition. No Worker redeploy is required.

## Verify before production

- Premium and lifetime can both generate journal and report analyses.
- Malformed requests do not increment usage. A pre-output upstream failure
  refunds; replaying settlement cannot refund again. Successful/partial requests
  consume quota. Midnight UTC resets the daily allowance; refunds use the
  reservation's original day. Retry abuse caps at 30 reserved attempts/day.
- Mid-stream failure and truncated network responses show an error and are not
  auto-saved as a completed report. Cancelling stops upstream work.
- A new connection is discovered before its automatic first sync. Bad report
  HTML/CSV shows an error; history and the previous checkpoint remain intact.
- Broker-disabled/disconnected accounts remain available with stored balances
  and trades. No Retire/Restore controls remain.
- User A creates a goal, signs out, and user B sees none of A's goals. A second
  browser signed into A loads A's saved goals. Test an offline save and retry.
- In a test project, expire a Discord-only lease and verify AI is denied. A
  user with a paid billing source must keep access. Unlinking Discord immediately
  invalidates its source even before the clear call. Verify metadata spoofing
  cannot grant access. Account settings must offer renewed Discord sign-in.

## Operational notes

The maximum normal role-revocation delay is one hour. This design intentionally
does not create a bot or scheduled job. `profiles.plan` is a historical snapshot
between writes: always use the live entitlement RPC for new authorization gates.
Client-only charts and locally cached data are not server-enforced subscriptions.

If quota settlement fails twice because the database is unavailable, the
reservation stays charged conservatively. Inspect server logs by request ID;
the idempotent `finish_ai_request` RPC can safely be retried by an administrator
after confirming whether output was generated. Never refund completed output.
An abandoned reservation stops blocking concurrent work after two minutes but
remains charged. The private attempt ledger can be retained/archived under an
explicit data-retention policy; this migration does not prune it automatically.

For rollback, prefer a forward fix or pause AI generation while investigating.
Do not drop the new tables/columns or restore the old metadata-based permission
logic. Rolling back only the frontend may hide new goals and expiry notices;
their stored rows remain intact. No migration rollback is needed for account UI.

## Local verification

Verified for this change: 68 frontend tests and 12 backend tests passed; seven
pre-existing frontend TODO tests remain. Angular/server type checks and the
disposable database harness passed. No production build or live deployment ran.

```bash
./node_modules/.bin/ngc --noEmit -p tsconfig.app.json
npm test -- --watch=false
npx --yes deno check --no-lock --node-modules-dir=none supabase/functions/ai-report/index.ts supabase/functions/resolve-plan/index.ts
npx --yes deno test --no-lock --node-modules-dir=none supabase/functions/_shared/p2-security.test.ts
npx --yes deno run --no-lock --node-modules-dir=none --allow-read --allow-env scripts/test-database.ts
```

The database harness is disposable in-memory Postgres, not the live Supabase
project. Mocked provider/stream tests do not contact Discord, Tradovate or OpenAI.
Live sign-in, provider report variants and deployed streaming still require the
smoke checks above.

Sources: [Supabase user metadata and authorization](https://supabase.com/docs/guides/auth/users),
[Supabase identities](https://supabase.com/docs/guides/auth/identities),
[Discord user/membership API](https://docs.discord.com/developers/resources/user).
