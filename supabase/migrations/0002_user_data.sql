-- Phase 2: user data moves from localStorage to Postgres.
-- Every table is owner-scoped: RLS enabled, all four operations restricted
-- to user_id = auth.uid(), and user_id defaults to auth.uid() so clients
-- never send (or spoof) it.
--
-- ids are client-generated text (the app predates this backend and existing
-- ids are not uuids), so primary keys are composite (user_id, id) — this also
-- prevents id collisions between users and doubles as the (user_id) index.

-- ── shared updated_at trigger ────────────────────────────────────────────

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ── trades ───────────────────────────────────────────────────────────────

create table public.trades (
    id text not null,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

    -- basic info
    symbol text not null,
    asset_type text not null check (asset_type in ('stock', 'option', 'forex', 'futures', 'crypto')),
    direction text not null check (direction in ('long', 'short')),

    -- entry (dates kept as ISO strings, matching the client model exactly)
    entry_date text not null,
    entry_time text,
    entry_price numeric not null,
    quantity numeric not null,

    -- exit
    exit_date text,
    exit_time text,
    exit_price numeric,

    -- fees & calculations
    fees numeric,
    multiplier numeric,
    pnl numeric,
    pnl_percent numeric,
    net_pnl numeric,

    -- strategy & psychology
    setup text,
    playbook_id text,
    tags jsonb,
    emotions jsonb,

    -- grading
    grade text check (grade in ('A', 'B', 'C', 'D')),
    mistakes jsonb,
    went_well text,
    to_improve text,

    -- broker integration
    source text check (source in ('manual', 'tradovate')),
    external_id text,
    connection_id text,
    account_id text,
    account_name text,

    -- notes & media
    notes text,
    screenshots jsonb,

    status text not null check (status in ('open', 'closed', 'missed')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (user_id, id)
);

-- Day-scoped queries (calendar, journal day view).
create index trades_user_entry_date_idx on public.trades (user_id, entry_date);
-- Broker-fill dedupe guard (client also checks, this is the backstop).
create unique index trades_user_external_id_idx
    on public.trades (user_id, external_id)
    where external_id is not null;

alter table public.trades enable row level security;

create policy "Users select own trades" on public.trades
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own trades" on public.trades
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own trades" on public.trades
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own trades" on public.trades
    for delete to authenticated using (user_id = auth.uid());

create trigger trades_set_updated_at
    before update on public.trades
    for each row execute function public.set_updated_at();

-- ── journal_entries (daily notes) ────────────────────────────────────────

create table public.journal_entries (
    id text not null,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

    date text not null, -- YYYY-MM-DD
    content text not null default '',
    pre_market_plan text,
    post_market_review text,
    mood smallint check (mood between 1 and 5),
    discipline smallint check (discipline between 1 and 5),
    rules_followed jsonb,
    -- deprecated in the client model but still persisted for old notes
    avoided_news_events jsonb,
    custom_news_events jsonb,
    news_event_tags jsonb,
    tags jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (user_id, id)
);

-- One note per user per day; also serves day-scoped lookups.
create unique index journal_entries_user_date_idx on public.journal_entries (user_id, date);

alter table public.journal_entries enable row level security;

create policy "Users select own journal entries" on public.journal_entries
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own journal entries" on public.journal_entries
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own journal entries" on public.journal_entries
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own journal entries" on public.journal_entries
    for delete to authenticated using (user_id = auth.uid());

create trigger journal_entries_set_updated_at
    before update on public.journal_entries
    for each row execute function public.set_updated_at();

-- ── journal_templates ────────────────────────────────────────────────────

create table public.journal_templates (
    id text not null,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

    name text not null,
    type text not null check (type in ('plan', 'notes')),
    content text not null, -- HTML from Quill

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (user_id, id)
);

alter table public.journal_templates enable row level security;

create policy "Users select own templates" on public.journal_templates
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own templates" on public.journal_templates
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own templates" on public.journal_templates
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own templates" on public.journal_templates
    for delete to authenticated using (user_id = auth.uid());

create trigger journal_templates_set_updated_at
    before update on public.journal_templates
    for each row execute function public.set_updated_at();

-- ── user_settings (one row per user) ─────────────────────────────────────

create table public.user_settings (
    user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,

    starting_balance numeric not null default 25000,
    commission_per_contract numeric not null default 0.25,
    custom_rules jsonb,           -- journal rules checklist (null → client defaults)
    prefs jsonb not null default '{}'::jsonb,

    -- set exactly once, after the legacy localStorage data has been uploaded;
    -- null means the one-time import hasn't run for this user yet
    imported_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users select own settings" on public.user_settings
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own settings" on public.user_settings
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own settings" on public.user_settings
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own settings" on public.user_settings
    for delete to authenticated using (user_id = auth.uid());

create trigger user_settings_set_updated_at
    before update on public.user_settings
    for each row execute function public.set_updated_at();
