# Supabase backend

Server-side pieces for auth and plan resolution. Nothing here ships in the
Angular bundle.

## Layout

- `migrations/` — SQL schema (profiles table, RLS, signup trigger)
- `functions/resolve-plan/` — Edge Function that verifies Discord roles and
  writes `profiles.plan` (see `functions/README.md`)

## Applying migrations

Either paste the contents of `migrations/0001_profiles.sql` into the
**Supabase dashboard → SQL editor** and run it, or use the CLI:

```bash
supabase link --project-ref elbcjsewyqptrckdydha
supabase db push
```

## Dashboard configuration (one-time)

1. **Auth → Providers → Discord**: enable, set the Discord app's client id +
   secret, and register the Supabase callback URL in the Discord developer
   portal.
2. **Auth → URL configuration**: add the app origins to the redirect
   allow-list, e.g. `http://localhost:4200/auth/callback` and
   `https://<your-app-domain>/auth/callback` (a `?returnUrl=...` query param
   is appended at runtime; the allow-list matches on path, so wildcards are
   not needed).

## Security model

- All tables have RLS enabled; the client's publishable key can only read
  the caller's own `profiles` row.
- `profiles.plan` has no client-writable policy — it changes only via the
  `resolve-plan` Edge Function, which uses the secret key. The secret key is
  never stored in this repo; it lives in Supabase function secrets.
