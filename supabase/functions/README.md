# Edge Functions

## resolve-plan

Verifies the caller's Discord guild roles (using the Discord provider token
from their own OAuth session) and updates `profiles.plan`. This function is
the only writer of `plan` — it runs with the Supabase secret key, which
exists **only** as a function secret, never in this repo or the client.

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
- Not in the guild / no matching roles → `free`.
- Returns `{ "plan": "free" | "premium" | "lifetime" }`.
