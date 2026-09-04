# P1 security and data-integrity fixes

Local changes only. No deployed functions, real users, subscriptions, or production rows were changed during this work.

## Deployment order

1. Back up the database and verify a restore path. Confirm earlier migrations through `0015` match the deployed schema.
2. Run `0016_owner_safe_trade_upsert.sql`, then `0017_billing_safety.sql` in a staging project first. Neither migration deletes existing account/trade data. The new frontend requires `0016` before it can save trades.
3. If `0017` reports duplicate Stripe customer IDs, stop and reconcile those customer associations manually. Do not delete billing rows or subscriptions to force the index through.
4. Deploy the three functions (their `_shared` imports are bundled automatically):

```sh
npx supabase functions deploy create-checkout
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy delete-account
```

5. Deploy the web application and publish a newly built desktop installer. Leave JWT/signature checks enabled as implemented. Stripe webhook verification is inside the function; do not disable its signature check.
6. If a desktop installer containing `.env` was distributed, rotate its Discord client secret in Discord and Supabase. Removing it from new packages cannot revoke copies in old installers. Do not package any secret file.

Use Stripe test-mode keys/prices/webhook secrets together in staging. Never make a test charge using production keys. The existing server secret names are unchanged; `APP_ORIGIN` must be your HTTPS web origin.

## What changed

- Global Markdown sanitization restored; checked/unchecked task markers remain visible.
- Every broker/data operation captures an authenticated owner. User changes invalidate late loads, broker logins, renewals, AI results, and saves.
- Durable, user-owned outbox for trades, notes, templates, settings, accounts, and connection metadata. Writes stay pending until acknowledged; retries never silently drop rejected writes. Logging out does not delete database history or this outbox.
- Paginated reads for full trade/note/template/account/connection history, including projects with row caps smaller than the requested page size.
- Atomic, owner-checked trade upserts preserve canonical trade IDs and notes when two tabs import the same external fill. Different-format possible duplicates are held for review, not silently merged or inserted. Existing duplicates are not automatically deleted.
- Historical accounts remain selectable. Trades and balances use the same explicit selection; deselecting all no longer means all accounts. Unknown/partial balances display as unavailable rather than an incorrect total.
- Electron keeps Chromium security enabled, rejects path traversal, limits navigation, and no longer ships or uses the legacy Discord client secret/IPC login.
- Checkout uses per-user serialization and idempotency, reuses open sessions, and blocks a second subscription. Webhooks read current Stripe state and atomically update billing, entitlement, and event receipt; delayed events cannot overwrite a newer active subscription.

The webhook handling follows [Stripe’s delivery/replay guidance](https://docs.stripe.com/webhooks), and desktop hardening follows [Electron’s security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- Account deletion requires an interactive login within ten minutes. It expires open checkouts and cancels all journal subscriptions before deleting the user. Failed cancellation retains the user and billing linkage, and blocks new checkout until deletion is completed. It does not issue refunds or cancel a separate Whop/Discord membership.

## Verification before production

- Two different users: switch while sync/load/AI is pending; confirm no late data appears in the next account. Repeat in two tabs.
- Disconnect networking, edit a note/import trades, close and reopen the app, reconnect and retry. Confirm the pending status clears only when data is present in Supabase.
- More than 1,000 trades: compare DB counts and oldest dates with all loaded app trades.
- CSV + old HTML imports: exact fill repeats are skipped; possible cross-format matches are held for review. Keep the original export until reconciled. Do not delete historical trades to bypass a conflict.
- Active + historical + manual selections: verify dashboard, journal, calendar and balance agree. Deselect all and test missing balance values.
- Stripe sandbox: simultaneous subscribe clicks, retry after interrupted checkout, replay/out-of-order webhook events, and deletion with a simulated Stripe failure. Confirm only one subscription is created and failed deletion retains the account.
- Packaged Electron: login with each enabled provider, broker connection, API calls, deep links, and missing asset handling. Desktop OAuth provider redirects and production CORS still require a packaged smoke test.

## Repeatable local checks

```sh
npm test -- --watch=false
node --test electron/security.test.js
npx deno check --no-lock --node-modules-dir=none supabase/functions/create-checkout/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/delete-account/index.ts
npx deno test --no-lock --node-modules-dir=none supabase/functions/_shared/billing-lifecycle.test.ts
npx deno run --no-lock --node-modules-dir=none --allow-read --allow-env scripts/test-database.ts
```

The database check runs against disposable in-memory Postgres, with simulated auth roles and users. It never connects to Supabase. The billing lifecycle tests use simulated Stripe responses. Staging/provider/end-to-end checks remain necessary; these tests are not proof of the deployed configuration.

Browser storage is device-local, not a substitute for a backup. Keep the original CSV while saves are pending; do not clear browser storage to troubleshoot a pending save. Unowned legacy caches are not automatically assigned to the next person signing in.
