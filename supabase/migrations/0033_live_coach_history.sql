-- Saved Live Coach observations. Does not touch trades, accounts, or entitlements.
-- Run before deploying the history UI. Safe to rerun.
begin;

create table if not exists public.live_coach_history (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null,
    observed_at timestamptz not null,
    trade_date date not null,
    title text not null check (char_length(title) between 1 and 160),
    content text not null check (char_length(content) between 1 and 4000),
    personalized boolean not null default false,
    snapshot jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 16000)),
    explanation jsonb check (explanation is null or (jsonb_typeof(explanation) = 'object' and octet_length(explanation::text) <= 6000)),
    session_comparison jsonb check (session_comparison is null or (jsonb_typeof(session_comparison) = 'object' and octet_length(session_comparison::text) <= 6000)),
    created_at timestamptz not null default now(),
    primary key (user_id, id)
);

create index if not exists live_coach_history_recent_idx on public.live_coach_history (user_id, observed_at desc, id desc);
create index if not exists live_coach_history_day_idx on public.live_coach_history (user_id, trade_date, observed_at desc, id desc);
alter table public.live_coach_history enable row level security;

drop policy if exists coach_history_select on public.live_coach_history;
create policy coach_history_select on public.live_coach_history for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists coach_history_insert on public.live_coach_history;
create policy coach_history_insert on public.live_coach_history for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists coach_history_update on public.live_coach_history;
create policy coach_history_update on public.live_coach_history for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists coach_history_delete on public.live_coach_history;
create policy coach_history_delete on public.live_coach_history for delete to authenticated using (user_id = (select auth.uid()));

-- History remains readable after a downgrade. This table never grants AI access.
-- Only follow-up columns can change; captured context and ownership are immutable.
revoke all on public.live_coach_history from public, anon, authenticated;
grant select, insert, delete on public.live_coach_history to authenticated;
grant update (explanation, session_comparison) on public.live_coach_history to authenticated;
grant all on public.live_coach_history to service_role;
comment on table public.live_coach_history is 'Private saved coaching text and captured context. No audio, credentials or broker tokens. Not an authoritative trading ledger.';
commit;
