-- Explicit, account-wide opt-in for mature coaching language. No existing data changes.
begin;
create table if not exists public.ai_coaching_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    unhinged boolean not null default false,
    consent_version integer,
    consented_at timestamptz,
    updated_at timestamptz not null default now(),
    check (not unhinged or (consent_version is not null and consent_version = 1 and consented_at is not null))
);
alter table public.ai_coaching_preferences enable row level security;
drop policy if exists ai_coaching_preferences_select on public.ai_coaching_preferences;
create policy ai_coaching_preferences_select on public.ai_coaching_preferences
    for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ai_coaching_preferences from public, anon, authenticated;
grant select on public.ai_coaching_preferences to authenticated, service_role;

-- Writes go only through this bounded owner-only function; callers cannot forge
-- another user's consent, a consent timestamp, or a future disclaimer version.
create or replace function public.set_my_ai_coaching_mode(p_unhinged boolean, p_accept_terms boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    saved public.ai_coaching_preferences;
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if p_unhinged is null then raise exception 'A coaching mode is required'; end if;
    if p_unhinged and p_accept_terms is distinct from true then
        raise exception 'Accept the Unhinged Coach disclaimer before enabling';
    end if;
    if p_unhinged and public.effective_user_ai_access(owner_id) is distinct from true then
        raise exception 'AI access required';
    end if;
    insert into public.ai_coaching_preferences(user_id, unhinged, consent_version, consented_at)
    values (owner_id, p_unhinged, case when p_unhinged then 1 end, case when p_unhinged then now() end)
    on conflict (user_id) do update set
        unhinged = excluded.unhinged,
        consent_version = case when excluded.unhinged then 1 else public.ai_coaching_preferences.consent_version end,
        consented_at = case when excluded.unhinged then now() else public.ai_coaching_preferences.consented_at end,
        updated_at = now()
    returning * into saved;
    return to_jsonb(saved) - 'user_id';
end;
$$;
revoke all on function public.set_my_ai_coaching_mode(boolean, boolean) from public, anon;
grant execute on function public.set_my_ai_coaching_mode(boolean, boolean) to authenticated;
comment on table public.ai_coaching_preferences is 'Explicit mature-language opt-in, not an AI entitlement. Saved outputs retain their original wording.';
notify pgrst, 'reload schema';
commit;
