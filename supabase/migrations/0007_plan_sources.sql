-- Plan sources: the effective `plan` is now COMPUTED from several independent
-- sources instead of being written directly. This lets Discord roles, billing
-- (Stripe, later), and an admin override coexist without clobbering each other.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).
--
-- Sources (all null-able, all service-role-only to write):
--   plan_override — admin escape hatch; wins outright when set.
--   billing_plan  — future Stripe/billing entitlement.
--   discord_plan  — resolve-plan Edge Function writes this from Discord roles.
-- Effective `plan` = plan_override, else the highest of billing_plan /
-- discord_plan, else 'free'. Rank: lifetime > premium > free.

-- ── source columns ────────────────────────────────────────────────────────
-- plan_override already exists (added in the dashboard); `if not exists`
-- keeps this migration idempotent and safe to re-run.
alter table public.profiles
    add column if not exists plan_override text check (plan_override in ('free', 'premium', 'lifetime')),
    add column if not exists discord_plan  text check (discord_plan  in ('free', 'premium', 'lifetime')),
    add column if not exists billing_plan  text check (billing_plan  in ('free', 'premium', 'lifetime'));

-- ── plan ranking ──────────────────────────────────────────────────────────
-- Maps a plan (or null) to a comparable rank. null / unknown → 0.
create or replace function public.plan_rank(p text)
returns int
language sql
immutable
set search_path = ''
as $$
    select case p
        when 'lifetime' then 3
        when 'premium'  then 2
        when 'free'     then 1
        else 0
    end;
$$;

-- ── effective-plan computation ────────────────────────────────────────────
-- Recomputes NEW.plan from the source columns. plan_override short-circuits
-- via coalesce; otherwise the higher-ranked of billing_plan / discord_plan
-- wins, defaulting to 'free'. A null source ranks 0 and so never suppresses a
-- paid source.
create or replace function public.compute_profile_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.plan := coalesce(
        new.plan_override,
        case greatest(public.plan_rank(new.billing_plan), public.plan_rank(new.discord_plan))
            when 3 then 'lifetime'
            when 2 then 'premium'
            else 'free'
        end
    );
    return new;
end;
$$;

-- Fires on every insert and on any update that touches a source column, so the
-- effective plan is always kept in sync with its inputs.
drop trigger if exists profiles_compute_plan on public.profiles;
create trigger profiles_compute_plan
    before insert or update of plan_override, billing_plan, discord_plan
    on public.profiles
    for each row
    execute function public.compute_profile_plan();

-- ── backfill ──────────────────────────────────────────────────────────────
-- Seed discord_plan from the current (Discord-derived) plan for Discord users,
-- BEFORE any recompute could zero it out. Setting discord_plan is itself an
-- update of a source column, so the trigger fires and recomputes plan to the
-- same (or, with an override, higher) value — nobody loses current access.
--
-- Non-Discord rows (email/social, discord_id null) are intentionally left
-- untouched: their plan column is preserved as-is. To keep a manually-granted
-- paid plan for such a user going forward, set their plan_override.
update public.profiles
set discord_plan = plan
where discord_id is not null
  and discord_plan is null;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- No changes. profiles stays select-own with no client insert/update policy
-- (see 0001_profiles.sql), so users cannot write plan, plan_override,
-- discord_plan, or billing_plan. Only the service role (Edge Functions) writes
-- discord_plan / billing_plan; only an admin sets plan_override. The effective
-- plan is always derived by the trigger, never client-set.
