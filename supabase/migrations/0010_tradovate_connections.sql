-- Tradovate broker connections — the NON-SECRET metadata that lets a user's
-- broker setup roam across browsers and devices (Phase 2 moved trades/journal
-- to Postgres; this extends the same owner-scoped pattern to connections).
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).
--
-- SECURITY — READ BEFORE ADDING COLUMNS OR WRITING ROWS:
-- This table stores ONLY non-secret connection metadata (connection id, the
-- user-facing name, the account list, the active-account selection, environment
-- + auth-mode config, created/last-synced timestamps). OAuth access tokens and
-- ANY credential/secret must NEVER be written here — they stay in the client's
-- memory / localStorage and are exchanged server-side by the tradovate-proxy
-- Worker. The application strips the token before persisting (see
-- TradovateService.connectionToRow). Do not add a token/secret column.
--
-- Owner-scoped like every other table: RLS enabled, all four operations
-- restricted to user_id = auth.uid(), and user_id defaults to auth.uid() so
-- clients never send (or spoof) it — matching 0002_user_data.sql exactly.

create table public.tradovate_connections (
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    connection_id text not null,

    data jsonb not null default '{}'::jsonb,  -- non-secret metadata (NEVER the token/credentials)
    is_active boolean not null default false, -- which connection is the active one for this user

    updated_at timestamptz not null default now(),

    primary key (user_id, connection_id)
);

-- List a user's connections.
create index tradovate_connections_user_idx on public.tradovate_connections (user_id);

alter table public.tradovate_connections enable row level security;

create policy "Users select own tradovate connections" on public.tradovate_connections
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own tradovate connections" on public.tradovate_connections
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own tradovate connections" on public.tradovate_connections
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own tradovate connections" on public.tradovate_connections
    for delete to authenticated using (user_id = auth.uid());

comment on table public.tradovate_connections is
    'Non-secret Tradovate connection metadata only. OAuth tokens and credentials must never be stored here.';
