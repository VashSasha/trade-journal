-- Account-synced AI coaching opt-in plus a quota isolated from full reports.
-- Raw broker events are never persisted: only aggregate request accounting.
begin;

create table public.live_coach_ai_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    day date not null,
    count integer not null default 0 check (count >= 0),
    primary key (user_id, day)
);

alter table public.live_coach_ai_usage enable row level security;
revoke all on public.live_coach_ai_usage from public, anon, authenticated;
grant select on public.live_coach_ai_usage to authenticated;
create policy "Users view own Live Coach AI usage" on public.live_coach_ai_usage
    for select to authenticated using (user_id = auth.uid());

create table public.live_coach_ai_requests (
    user_id uuid not null references auth.users(id) on delete cascade,
    id uuid not null,
    day date not null,
    created_at timestamptz not null default now(),
    status text not null default 'reserved' check (status in ('reserved', 'completed', 'refunded')),
    primary key (user_id, id)
);

create index live_coach_ai_requests_user_day
    on public.live_coach_ai_requests(user_id, day);
alter table public.live_coach_ai_requests enable row level security;
revoke all on public.live_coach_ai_requests from public, anon, authenticated;
grant all on public.live_coach_ai_requests to service_role;

create function public.reserve_live_coach_ai_request(p_user_id uuid, p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_day date := (now() at time zone 'UTC')::date;
    v_status text;
    v_count integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 26));
    select status into v_status
    from public.live_coach_ai_requests
    where user_id = p_user_id and id = p_request_id;
    if found then return 'duplicate'; end if;

    if (select count(*) from public.live_coach_ai_requests
        where user_id = p_user_id and day = v_day) >= 60 then
        return 'attempt_limit';
    end if;
    if exists (
        select 1 from public.live_coach_ai_requests
        where user_id = p_user_id and status = 'reserved'
          and created_at > now() - interval '30 seconds'
    ) then
        return 'busy';
    end if;

    insert into public.live_coach_ai_usage(user_id, day, count)
    values (p_user_id, v_day, 0)
    on conflict (user_id, day) do nothing;
    update public.live_coach_ai_usage
    set count = count + 1
    where user_id = p_user_id and day = v_day and count < 30
    returning count into v_count;
    if not found then return 'daily_limit'; end if;

    insert into public.live_coach_ai_requests(user_id, id, day)
    values (p_user_id, p_request_id, v_day);
    return 'reserved';
end;
$$;

create function public.finish_live_coach_ai_request(
    p_user_id uuid,
    p_request_id uuid,
    p_success boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_day date;
begin
    if p_success is null then raise exception 'Success is required'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 26));
    update public.live_coach_ai_requests
    set status = case when p_success then 'completed' else 'refunded' end
    where user_id = p_user_id and id = p_request_id and status = 'reserved'
    returning day into v_day;
    if found and not p_success then
        update public.live_coach_ai_usage
        set count = greatest(0, count - 1)
        where user_id = p_user_id and day = v_day;
    end if;
end;
$$;

revoke all on function public.reserve_live_coach_ai_request(uuid, uuid),
    public.finish_live_coach_ai_request(uuid, uuid, boolean)
    from public, anon, authenticated;
grant execute on function public.reserve_live_coach_ai_request(uuid, uuid),
    public.finish_live_coach_ai_request(uuid, uuid, boolean)
    to service_role;

comment on table public.live_coach_ai_usage is
    'Private per-user daily usage for short Live Coach AI comments; separate from full AI reports.';
comment on table public.live_coach_ai_requests is
    'Retry-safe Live Coach AI request ledger. No trade or broker data is retained.';

-- Extend the existing validated alert RPC with the portable AI opt-in.
create or replace function public.set_my_account_alert_preferences(
    p_kind text,
    p_preferences jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    normalized jsonb := '{}'::jsonb;
    rule_name text;
    rule_value jsonb;
    threshold_value numeric;
    lead_value numeric;
    cooldown_value numeric;
    rate_value numeric;
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if p_preferences is null or jsonb_typeof(p_preferences) <> 'object'
        or octet_length(p_preferences::text) > 4000 then
        raise exception 'Invalid alert preferences';
    end if;

    if p_kind = 'performance_alerts' then
        foreach rule_name in array array[
            'dailyProfit', 'dailyLoss', 'weeklyProfit', 'weeklyLoss', 'dailyTrades'
        ] loop
            rule_value := p_preferences->rule_name;
            if jsonb_typeof(rule_value) is distinct from 'object'
                or jsonb_typeof(rule_value->'enabled') is distinct from 'boolean'
                or jsonb_typeof(rule_value->'value') is distinct from 'number' then
                raise exception 'Invalid performance alert rule: %', rule_name;
            end if;
            threshold_value := (rule_value->>'value')::numeric;
            if rule_name = 'dailyTrades' then
                if threshold_value < 1 or threshold_value > 1000
                    or threshold_value <> trunc(threshold_value) then
                    raise exception 'Daily trade limit must be a whole number from 1 to 1000';
                end if;
                normalized := normalized || jsonb_build_object(rule_name, jsonb_build_object(
                    'enabled', (rule_value->>'enabled')::boolean,
                    'value', threshold_value::integer
                ));
            else
                if threshold_value < 1 or threshold_value > 10000000
                    or threshold_value <> round(threshold_value, 2) then
                    raise exception 'Money thresholds must be from 1 to 10000000 with at most two decimals';
                end if;
                normalized := normalized || jsonb_build_object(rule_name, jsonb_build_object(
                    'enabled', (rule_value->>'enabled')::boolean,
                    'value', threshold_value
                ));
            end if;
        end loop;
    elsif p_kind = 'market_event_alerts' then
        if jsonb_typeof(p_preferences->'enabled') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'leadMinutes') is distinct from 'number'
            or jsonb_typeof(p_preferences->'highOnly') is distinct from 'boolean' then
            raise exception 'Invalid market-event alert preferences';
        end if;
        lead_value := (p_preferences->>'leadMinutes')::numeric;
        if lead_value <> trunc(lead_value) or lead_value not in (5, 10, 15, 30, 60) then
            raise exception 'Unsupported market-event lead time';
        end if;
        normalized := jsonb_build_object(
            'enabled', (p_preferences->>'enabled')::boolean,
            'leadMinutes', lead_value::integer,
            'highOnly', (p_preferences->>'highOnly')::boolean
        );
    elsif p_kind = 'live_coach' then
        if jsonb_typeof(p_preferences->'enabled') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'aiCommentary') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'entries') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'sizing') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'exits') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'guardrails') is distinct from 'boolean'
            or jsonb_typeof(p_preferences->'cooldownSeconds') is distinct from 'number'
            or jsonb_typeof(p_preferences->'speechRate') is distinct from 'number' then
            raise exception 'Invalid Live Coach preferences';
        end if;
        cooldown_value := (p_preferences->>'cooldownSeconds')::numeric;
        rate_value := (p_preferences->>'speechRate')::numeric;
        if cooldown_value < 5 or cooldown_value > 60
            or cooldown_value <> trunc(cooldown_value) then
            raise exception 'Live Coach cooldown must be a whole number from 5 to 60';
        end if;
        if rate_value < 0.8 or rate_value > 1.2
            or rate_value <> round(rate_value, 1) then
            raise exception 'Live Coach speech rate must be from 0.8 to 1.2';
        end if;
        normalized := jsonb_build_object(
            'enabled', (p_preferences->>'enabled')::boolean,
            'aiCommentary', (p_preferences->>'aiCommentary')::boolean,
            'entries', (p_preferences->>'entries')::boolean,
            'sizing', (p_preferences->>'sizing')::boolean,
            'exits', (p_preferences->>'exits')::boolean,
            'guardrails', (p_preferences->>'guardrails')::boolean,
            'cooldownSeconds', cooldown_value::integer,
            'speechRate', rate_value
        );
    else
        raise exception 'Unsupported alert preference kind';
    end if;

    insert into public.user_settings (user_id, prefs)
    values (owner_id, jsonb_build_object(p_kind, normalized))
    on conflict (user_id) do update
    set prefs = coalesce(public.user_settings.prefs, '{}'::jsonb)
        || jsonb_build_object(p_kind, normalized);
    return normalized;
end;
$$;

revoke all on function public.set_my_account_alert_preferences(text, jsonb) from public, anon;
grant execute on function public.set_my_account_alert_preferences(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
