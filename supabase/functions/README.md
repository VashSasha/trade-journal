# Edge Functions

## ai-report

Server-side proxy for all AI features (trade analysis, chart image analysis,
market prediction, streaming report generation). The OpenAI API key exists
**only** as a function secret — never in the repo or the client. The function:

- Rejects requests without a valid Supabase JWT (401).
- Requires `profiles.plan = 'lifetime'` — the server-side enforcement of what
  `planGuard('lifetime')` only enforces client-side (403 otherwise).
- Rate-limits to 10 requests per user per day via the `ai_usage` table,
  incremented atomically by `increment_ai_usage()` (429 when exceeded).
- `stream-analysis` requests return Server-Sent Events. OpenAI stream chunks
  are translated into the Anthropic wire shape (`content_block_delta` /
  `message_stop`) the client parser reads, so the client stays unchanged.

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
(see migration `0007_plan_sources.sql`). It runs with the Supabase secret key,
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
  `discord_id` (403) — prevents resolving someone else's roles.
- Not in the guild / no matching roles → `discord_plan` null.
- Returns `{ "plan": ..., "beta_access": ... }` (the trigger-computed effective plan).

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
