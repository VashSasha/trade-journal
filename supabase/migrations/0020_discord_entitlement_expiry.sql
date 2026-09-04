-- Discord roles are a renewable one-hour entitlement, not a permanent grant.
-- No broker/trade data changes. Billing and explicit admin overrides still win.
begin;
alter table public.profiles add column discord_plan_expires_at timestamptz;

create or replace function public.compute_profile_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.plan := coalesce(new.plan_override,
        case greatest(public.plan_rank(new.billing_plan),
            public.plan_rank(case when new.discord_plan_expires_at > now() then new.discord_plan end))
            when 3 then 'lifetime' when 2 then 'premium' else 'free' end);
    return new;
end;
$$;
drop trigger profiles_compute_plan on public.profiles;
create trigger profiles_compute_plan before insert or update of plan_override, billing_plan, discord_plan, discord_plan_expires_at
    on public.profiles for each row execute function public.compute_profile_plan();

-- Existing sources receive a one-hour transition only when their saved id
-- matches a real linked Discord identity. Mutable user metadata is not proof.
update public.profiles p set
    discord_plan = case when exists (select 1 from auth.identities i
        where i.user_id = p.id and i.provider = 'discord' and i.provider_id = p.discord_id) then p.discord_plan end,
    discord_plan_expires_at = case when exists (select 1 from auth.identities i
        where i.user_id = p.id and i.provider = 'discord' and i.provider_id = p.discord_id) then now() + interval '1 hour' end,
    discord_id = (select i.provider_id from auth.identities i where i.user_id = p.id and i.provider = 'discord' order by i.created_at limit 1);

-- Time passing doesn't fire row triggers. Authorization MUST use this live
-- calculation, never the stored profiles.plan snapshot alone.
create function public.effective_user_plan(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
    select coalesce(p.plan_override,
        case greatest(public.plan_rank(p.billing_plan), public.plan_rank(
            case when p.discord_plan_expires_at > now() and exists (
                select 1 from auth.identities i where i.user_id = p.id and i.provider = 'discord' and i.provider_id = p.discord_id
            ) then p.discord_plan end))
        when 3 then 'lifetime' when 2 then 'premium' else 'free' end)
    from public.profiles p where p.id = p_user_id;
$$;
revoke all on function public.effective_user_plan(uuid) from public, anon, authenticated;
grant execute on function public.effective_user_plan(uuid) to service_role;

create function public.get_my_entitlements()
returns table(plan text, discord_id text, beta_access boolean, discord_plan_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
    select public.effective_user_plan(auth.uid()), p.discord_id, p.beta_access, p.discord_plan_expires_at
    from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.get_my_entitlements() from public, anon;
grant execute on function public.get_my_entitlements() to authenticated;

-- The signup hook may use metadata for display only. Discord identity is set
-- by resolve-plan after checking the verified Auth identity and Discord token.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.profiles(id, email, display_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email));
    return new;
end;
$$;
commit;
