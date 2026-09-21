-- Premium+ owns AI. Premium and legacy Lifetime keep the same non-AI access.
-- No grandfathered AI grants and no trading data changes. Run before deploying functions.
begin;

alter table public.profiles
    add column if not exists ai_access_override boolean;
comment on column public.profiles.ai_access_override is
    'Admin only: null follows the plan, true grants AI, false disables AI. Premium/Lifetime do not include AI.';

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free','premium','premium_plus','lifetime','admin'));
alter table public.profiles drop constraint if exists profiles_plan_override_check;
alter table public.profiles add constraint profiles_plan_override_check check (plan_override in ('free','premium','premium_plus','lifetime','admin'));
alter table public.profiles drop constraint if exists profiles_discord_plan_check;
alter table public.profiles add constraint profiles_discord_plan_check check (discord_plan in ('free','premium','premium_plus','lifetime','admin'));
alter table public.profiles drop constraint if exists profiles_billing_plan_check;
alter table public.profiles add constraint profiles_billing_plan_check check (billing_plan in ('free','premium','premium_plus','lifetime','admin'));

create or replace function public.plan_rank(p text)
returns int language sql immutable set search_path = '' as $$
    select case p when 'admin' then 5 when 'premium_plus' then 4
        when 'lifetime' then 3 when 'premium' then 2 when 'free' then 1 else 0 end;
$$;

create or replace function public.compute_profile_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.plan := coalesce(new.plan_override,
        case greatest(public.plan_rank(new.billing_plan),
            public.plan_rank(case when new.discord_plan_expires_at > now() then new.discord_plan end))
            when 5 then 'admin' when 4 then 'premium_plus'
            when 3 then 'lifetime' when 2 then 'premium' else 'free' end);
    return new;
end;
$$;

-- Keep the live Discord identity + expiry check; stored plan is only a snapshot.
create or replace function public.effective_user_plan(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
    select coalesce(p.plan_override,
        case greatest(public.plan_rank(p.billing_plan), public.plan_rank(
            case when p.discord_plan_expires_at > now() and exists (
                select 1 from auth.identities i where i.user_id = p.id and i.provider = 'discord' and i.provider_id = p.discord_id
            ) then p.discord_plan end))
        when 5 then 'admin' when 4 then 'premium_plus'
        when 3 then 'lifetime' when 2 then 'premium' else 'free' end)
    from public.profiles p where p.id = p_user_id;
$$;

create or replace function public.effective_user_ai_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce((select coalesce(p.ai_access_override,
        public.effective_user_plan(p.id) in ('premium_plus', 'admin'))
        from public.profiles p where p.id = p_user_id), false);
$$;
revoke all on function public.effective_user_plan(uuid), public.effective_user_ai_access(uuid) from public, anon, authenticated;
grant execute on function public.effective_user_plan(uuid), public.effective_user_ai_access(uuid) to service_role;

-- Return type changes require recreation. It still exposes ONLY the current user's access.
drop function if exists public.get_my_entitlements();
create function public.get_my_entitlements()
returns table(plan text, discord_id text, beta_access boolean, discord_plan_expires_at timestamptz, ai_access boolean)
language sql stable security definer set search_path = '' as $$
    select public.effective_user_plan(auth.uid()), p.discord_id, p.beta_access,
        p.discord_plan_expires_at, public.effective_user_ai_access(auth.uid())
    from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.get_my_entitlements() from public, anon;
grant execute on function public.get_my_entitlements() to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update(display_name) on public.profiles to authenticated;

-- Remove the old implicit-Premium RPC: webhook must supply the tier resolved from its trusted price allowlist.
drop function if exists public.apply_billing_snapshot(uuid, uuid, text, text, text, text, text, timestamptz);
create or replace function public.apply_billing_snapshot(
    p_user_id uuid, p_token uuid, p_event_id text, p_customer_id text,
    p_subscription_id text, p_status text, p_price_id text, p_period_end timestamptz, p_plan text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
    if p_status in ('active', 'trialing') and (p_plan is null or p_plan not in ('premium', 'premium_plus')) then
        raise exception 'Unrecognized paid plan';
    end if;
    perform 1 from public.billing_operations where user_id = p_user_id
        and token = p_token and expires_at > now() for update;
    if not found then raise exception 'Billing operation expired'; end if;
    if exists(select 1 from public.billing_events where event_id = p_event_id) then return; end if;
    perform 1 from public.billing
        where user_id = p_user_id and stripe_customer_id = p_customer_id for update;
    if not found then raise exception 'Billing customer mismatch'; end if;
    -- Even an interrupted deletion must reflect actual Stripe access. Keep the
    -- deletion flag (blocks new checkout), but don't preserve stale paid access.
        update public.billing set stripe_subscription_id = p_subscription_id,
            status = p_status, price_id = p_price_id, current_period_end = p_period_end,
            updated_at = now() where user_id = p_user_id;
        update public.profiles set billing_plan = case when p_status in ('active','trialing')
            then p_plan else null end, updated_at = now() where id = p_user_id;
        if not found then raise exception 'Profile missing'; end if;
    insert into public.billing_events(event_id) values (p_event_id);
end;
$$;

revoke all on function public.apply_billing_snapshot(uuid, uuid, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.apply_billing_snapshot(uuid, uuid, text, text, text, text, text, timestamptz, text) to service_role;

-- Recompute the cached display value without modifying any plan source.
update public.profiles set billing_plan = billing_plan;
notify pgrst, 'reload schema';
commit;
