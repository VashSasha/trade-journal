-- Account-level receipts written only after trades are acknowledged by Supabase.
-- These record a successful requested range, not a guarantee of all-time coverage.
begin;
create table if not exists public.broker_sync_checkpoints (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    connection_id text not null check (length(connection_id) between 1 and 200),
    account_id bigint not null check (account_id > 0),
    synced_at timestamptz not null default now(),
    range_from timestamptz,
    range_to timestamptz not null,
    primary key (user_id, connection_id, account_id),
    check (range_from is null or range_from <= range_to)
);
alter table public.broker_sync_checkpoints enable row level security;
drop policy if exists "Owner sync receipts" on public.broker_sync_checkpoints;
create policy "Owner sync receipts" on public.broker_sync_checkpoints
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.broker_sync_checkpoints from public, anon, authenticated;
grant select, insert, update on public.broker_sync_checkpoints to authenticated;

create or replace function public.record_my_broker_sync(
    p_connection_id text, p_account_id bigint, p_from timestamptz, p_to timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare receipt public.broker_sync_checkpoints;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    insert into public.broker_sync_checkpoints(user_id, connection_id, account_id, range_from, range_to)
    values (auth.uid(), p_connection_id, p_account_id, p_from, p_to)
    on conflict (user_id, connection_id, account_id) do update
    set synced_at = clock_timestamp(), range_from = excluded.range_from, range_to = excluded.range_to
    returning * into receipt;
    return to_jsonb(receipt) - 'user_id';
end;
$$;
revoke all on function public.record_my_broker_sync(text,bigint,timestamptz,timestamptz) from public, anon;
grant execute on function public.record_my_broker_sync(text,bigint,timestamptz,timestamptz) to authenticated;
commit;
