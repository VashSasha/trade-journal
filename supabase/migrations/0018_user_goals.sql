-- Additive: never imports unowned browser goals, or modifies account/trade history.
begin;
create table public.goals (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null,
    type text not null check (type in ('monthly_pnl', 'yearly_pnl', 'monthly_trades', 'win_rate')),
    label text not null check (length(label) between 1 and 200),
    target numeric not null check (target > 0 and target < 'Infinity'::numeric),
    deadline timestamptz not null,
    period text not null check (period in ('month', 'year')),
    status text not null default 'active' check (status in ('active', 'achieved', 'failed')),
    primary key (user_id, id),
    check (type <> 'win_rate' or target <= 100)
);
alter table public.goals enable row level security;
create policy "Owners manage goals" on public.goals for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.goals from anon;
grant select, insert, update, delete on public.goals to authenticated;
grant all on public.goals to service_role;
commit;
