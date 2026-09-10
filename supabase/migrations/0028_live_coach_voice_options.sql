-- Expand the built-in AI voice catalog and default new voice choices to Cedar.
-- Existing saved selections (including browser voice) and opt-in flags are unchanged.
-- Old clients that omit voice keep the account's existing selection.
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
        if p_preferences ? 'voice' and (
            jsonb_typeof(p_preferences->'voice') is distinct from 'string'
            or p_preferences->>'voice' not in (
                'browser', 'cedar', 'marin', 'alloy', 'ash', 'ballad', 'coral', 'echo',
                'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'
            )
        ) then
            raise exception 'Unsupported Coach voice';
        end if;
        normalized := jsonb_build_object(
            'voice', coalesce(p_preferences->>'voice',
                (select prefs->'live_coach'->>'voice' from public.user_settings where user_id = owner_id),
                'cedar'),
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
