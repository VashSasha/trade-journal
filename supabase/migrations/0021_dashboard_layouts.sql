-- Per-user dashboard layout. Positions are presentation preferences only;
-- trade/account data remains in its canonical owner-scoped tables.
begin;

create table public.dashboard_layouts (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    page text not null check (length(page) between 1 and 50),
    schema_version smallint not null default 1 check (schema_version > 0),
    layout jsonb not null check (
        jsonb_typeof(layout) = 'array'
        and jsonb_array_length(layout) <= 50
        and octet_length(layout::text) <= 50000
    ),
    updated_at timestamptz not null default now(),
    primary key (user_id, page)
);

alter table public.dashboard_layouts enable row level security;

create trigger dashboard_layouts_set_updated_at
    before update on public.dashboard_layouts
    for each row execute function public.set_updated_at();

create policy "Owners manage dashboard layouts" on public.dashboard_layouts
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

revoke all on public.dashboard_layouts from anon;
grant select, insert, update, delete on public.dashboard_layouts to authenticated;
grant all on public.dashboard_layouts to service_role;

comment on table public.dashboard_layouts is
    'Owner-scoped, versioned UI layouts. Clients also keep a local cache for instant and offline rendering.';

commit;
