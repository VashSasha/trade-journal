-- Atomically merge account-synced sound controls into user_settings.prefs.
-- Runtime Web Audio state is deliberately excluded: every browser still needs
-- a user gesture after page load before it may play sounds.
begin;

create or replace function public.set_my_session_sound_preferences(p_preferences jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    normalized jsonb;
    sound_volume numeric;
begin
    if owner_id is null then
        raise exception 'Authentication required';
    end if;
    if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
        raise exception 'Sound preferences must be an object';
    end if;
    if jsonb_typeof(p_preferences->'volume') is distinct from 'number'
        or jsonb_typeof(p_preferences->'opens') is distinct from 'boolean'
        or jsonb_typeof(p_preferences->'closes') is distinct from 'boolean'
        or jsonb_typeof(p_preferences->'armed') is distinct from 'boolean' then
        raise exception 'Invalid sound preferences';
    end if;

    sound_volume := (p_preferences->>'volume')::numeric;
    if sound_volume < 0 or sound_volume > 100 or sound_volume <> trunc(sound_volume) then
        raise exception 'Sound volume must be a whole number from 0 to 100';
    end if;

    normalized := jsonb_build_object(
        'volume', sound_volume::integer,
        'opens', (p_preferences->>'opens')::boolean,
        'closes', (p_preferences->>'closes')::boolean,
        'armed', (p_preferences->>'armed')::boolean and sound_volume > 0
    );

    insert into public.user_settings (user_id, prefs)
    values (owner_id, jsonb_build_object('session_sounds', normalized))
    on conflict (user_id) do update
    set prefs = coalesce(public.user_settings.prefs, '{}'::jsonb) || excluded.prefs;

    return normalized;
end;
$$;

revoke all on function public.set_my_session_sound_preferences(jsonb) from public, anon;
grant execute on function public.set_my_session_sound_preferences(jsonb) to authenticated;

comment on function public.set_my_session_sound_preferences(jsonb) is
    'Validates and atomically merges the current user sound controls into user_settings.prefs.';

commit;
