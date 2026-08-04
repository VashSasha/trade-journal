-- Trading accounts with last-known balance — the permanent record of every
-- account a user has ever synced, independent of connection lifetime.
--
-- Connections come and go (tokens expire, users log out of a broker), but the
-- accounts and their trades must keep working everywhere: header selector,
-- dashboard, journal and calendar charts. Rows here are written on every
-- account/balance fetch and are NEVER deleted when a connection is removed —
-- an account with no live connection simply renders as "historical" with its
-- stored name, type, and last_balance.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).
--
-- Owner-scoped like every other table: RLS enabled, all four operations
-- restricted to user_id = auth.uid(), and user_id defaults to auth.uid() so
-- clients never send (or spoof) it — matching 0010_tradovate_connections.sql.

create table public.trading_accounts (
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    account_id bigint not null,             -- Tradovate account id

    connection_id text,               -- owning tradovate_connections id, if still connected
    name text not null,
    account_type text,
    active boolean not null default true,   -- broker-side active flag at last fetch

    last_balance numeric,                   -- last cash balance seen from the API
    balance_updated_at timestamptz,         -- when that balance was fetched

    updated_at timestamptz not null default now(),

    primary key (user_id, account_id)
);

-- List a user's accounts.
create index trading_accounts_user_idx on public.trading_accounts (user_id);

alter table public.trading_accounts enable row level security;

create policy "Users select own trading accounts" on public.trading_accounts
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own trading accounts" on public.trading_accounts
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own trading accounts" on public.trading_accounts
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own trading accounts" on public.trading_accounts
    for delete to authenticated using (user_id = auth.uid());

comment on table public.trading_accounts is
    'Per-account metadata and last known balance, used as a stale-while-revalidate fallback when the Tradovate API is unavailable.';
