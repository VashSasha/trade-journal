-- Account-synced performance guardrails and economic-event warning choices.
-- Browser notification permission and already-fired alert IDs remain local to
-- each device; only portable user intent is written here.
begin;

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
begin
    if owner_id is null then
        raise exception 'Authentication required';
    end if;
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

comment on function public.set_my_account_alert_preferences(text, jsonb) is
    'Validates and atomically merges portable alert settings into the current user settings.';

commit;
