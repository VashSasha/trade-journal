-- Public sound assets ship with the app; only each user's selected IDs are saved.
-- Additive and safe to re-run. No files, preferences, accounts, or trades deleted.
begin;

create or replace function public.is_alert_sound_kind(value text)
returns boolean language sql immutable set search_path = ''
as $$ select value in (
    'open', 'close', 'target', 'risk', 'dailyProfit', 'weeklyProfit', 'dailyLoss', 'weeklyLoss',
    'dailyTrades', 'dailyProfitOpen', 'marketEvent', 'positionOpened', 'positionIncreased',
    'positionReduced', 'positionClosed', 'positionReversed'
); $$;
revoke all on function public.is_alert_sound_kind(text) from public, anon;
grant execute on function public.is_alert_sound_kind(text) to authenticated, service_role;

alter table public.custom_alert_sounds drop constraint if exists custom_alert_sounds_kind_check;
alter table public.custom_alert_sounds add constraint custom_alert_sounds_kind_check
    check (public.is_alert_sound_kind(kind));

-- Extend the same owner-only storage paths; never make private uploads public.
drop policy if exists "Owners read custom alert sound files" on storage.objects;
create policy "Owners read custom alert sound files" on storage.objects
    for select to authenticated using (
        bucket_id = 'custom-alert-sounds' and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and public.is_alert_sound_kind(storage.filename(name))
    );
drop policy if exists "Owners upload custom alert sound files" on storage.objects;
create policy "Owners upload custom alert sound files" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'custom-alert-sounds' and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and public.is_alert_sound_kind(storage.filename(name))
    );
drop policy if exists "Owners replace custom alert sound files" on storage.objects;
create policy "Owners replace custom alert sound files" on storage.objects
    for update to authenticated using (
        bucket_id = 'custom-alert-sounds' and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and public.is_alert_sound_kind(storage.filename(name))
    ) with check (
        bucket_id = 'custom-alert-sounds' and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and public.is_alert_sound_kind(storage.filename(name))
    );
drop policy if exists "Owners delete custom alert sound files" on storage.objects;
create policy "Owners delete custom alert sound files" on storage.objects
    for delete to authenticated using (
        bucket_id = 'custom-alert-sounds' and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and public.is_alert_sound_kind(storage.filename(name))
    );

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
    choice record;
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
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
    if p_preferences ? 'selections' then
        if jsonb_typeof(p_preferences->'selections') is distinct from 'object' then
            raise exception 'Sound selections must be an object';
        end if;
        for choice in select key, value from jsonb_each(p_preferences->'selections') loop
            if not public.is_alert_sound_kind(choice.key)
                or jsonb_typeof(choice.value) is distinct from 'string'
                or (choice.value #>> '{}') not in (
                    'default', 'custom', 'silent', 'inherit', 'stock-market-bell', 'thinkorswim-bell',
                    'happy-whistle', 'hell-yeah', 'oh-no', 'come-on-man',
                    'female-voice', 'game-over', 'no-more-running', 'demonic-laughter'
                ) then
                raise exception 'Unsupported sound selection';
            end if;
        end loop;
        normalized := normalized || jsonb_build_object('selections', p_preferences->'selections');
    end if;

    insert into public.user_settings (user_id, prefs)
    values (owner_id, jsonb_build_object('session_sounds', normalized))
    on conflict (user_id) do update
    set prefs = jsonb_set(coalesce(public.user_settings.prefs, '{}'::jsonb), '{session_sounds}',
        coalesce(public.user_settings.prefs->'session_sounds', '{}'::jsonb)
        || (excluded.prefs->'session_sounds'))
    returning prefs->'session_sounds' into normalized;
    -- Old clients don't send selections: retain the existing library choices.
    return normalized;
end;
$$;

revoke all on function public.set_my_session_sound_preferences(jsonb) from public, anon;
grant execute on function public.set_my_session_sound_preferences(jsonb) to authenticated;
comment on function public.set_my_session_sound_preferences(jsonb) is
    'Owner-scoped sound controls and allowlisted library selections; retains selections for older clients.';

commit;
