-- Extend the existing progress document; preserve all preferences and records.
begin;

create or replace function public.set_my_onboarding_progress(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    saved jsonb;
begin
    if owner_id is null then
        raise exception 'Authentication required';
    end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'Setup progress must be an object';
    end if;
    if exists (
        select 1 from jsonb_each(p_patch) as entry
        where entry.key not in ('started', 'dismissed', 'accountsReviewed', 'alertsReviewed', 'templatesReviewed', 'journalReviewed')
            or jsonb_typeof(entry.value) <> 'boolean'
    ) then
        raise exception 'Invalid setup progress';
    end if;

    insert into public.user_settings (user_id, prefs)
    values (owner_id, jsonb_build_object('onboarding', p_patch))
    on conflict (user_id) do update
    set prefs = jsonb_set(
        coalesce(public.user_settings.prefs, '{}'::jsonb), '{onboarding}',
        (case when jsonb_typeof(public.user_settings.prefs->'onboarding') = 'object'
            then public.user_settings.prefs->'onboarding' else '{}'::jsonb end) || p_patch
    )
    returning prefs->'onboarding' into saved;

    return saved;
end;
$$;

revoke all on function public.set_my_onboarding_progress(jsonb) from public, anon;
grant execute on function public.set_my_onboarding_progress(jsonb) to authenticated;

commit;
