-- Preserve existing daily usage. Atomic reservations cap concurrent requests;
-- failed attempts can be refunded exactly once, but retries are not unlimited.
begin;
create table public.ai_requests (
    user_id uuid not null references auth.users(id) on delete cascade,
    id uuid not null,
    day date not null,
    created_at timestamptz not null default now(),
    status text not null default 'reserved' check (status in ('reserved', 'completed', 'refunded')),
    primary key (user_id, id)
);
create index ai_requests_user_day on public.ai_requests(user_id, day);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public, anon, authenticated;
grant all on public.ai_requests to service_role;

create function public.reserve_ai_request(p_user_id uuid, p_request_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date; v_status text; v_count integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 19));
    select status into v_status from public.ai_requests where user_id = p_user_id and id = p_request_id;
    if found then return 'duplicate'; end if;
    if (select count(*) from public.ai_requests where user_id = p_user_id and day = v_day) >= 30 then
        return 'attempt_limit';
    end if;
    if exists (select 1 from public.ai_requests where user_id = p_user_id and status = 'reserved'
        and created_at > now() - interval '2 minutes') then return 'busy'; end if;
    insert into public.ai_usage(user_id, day, count) values (p_user_id, v_day, 0)
        on conflict (user_id, day) do nothing;
    update public.ai_usage set count = count + 1
        where user_id = p_user_id and day = v_day and count < 10 returning count into v_count;
    if not found then return 'daily_limit'; end if;
    insert into public.ai_requests(user_id, id, day) values (p_user_id, p_request_id, v_day);
    return 'reserved';
end;
$$;

create function public.finish_ai_request(p_user_id uuid, p_request_id uuid, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_day date;
begin
    if p_success is null then raise exception 'Success is required'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 19));
    update public.ai_requests set status = case when p_success then 'completed' else 'refunded' end
        where user_id = p_user_id and id = p_request_id and status = 'reserved' returning day into v_day;
    if found and not p_success then
        update public.ai_usage set count = greatest(0, count - 1) where user_id = p_user_id and day = v_day;
    end if;
end;
$$;
revoke all on function public.reserve_ai_request(uuid, uuid), public.finish_ai_request(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid, uuid), public.finish_ai_request(uuid, uuid, boolean) to service_role;
comment on table public.ai_requests is 'Private AI attempt ledger. A started/partial response consumes quota; pre-output failures refund once. Stale reservations remain charged conservatively.';
commit;
