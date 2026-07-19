-- Closed-beta access gate. `beta_access` decides whether a user may use the
-- app while beta mode is on. Like `plan`, it is ONLY written server-side:
-- the resolve-plan Edge Function sets it from the caller's Discord roles.
-- Clients keep select-own access and no insert/update policy, so the flag
-- cannot be forged from the browser.

alter table public.profiles
    add column beta_access boolean not null default false;

-- No new RLS policies: profiles stays select-own (see 0001_profiles.sql).
--
-- Email/password users have no Discord identity (discord_id is null), so
-- resolve-plan never touches their row. Grant those users beta access
-- manually in the Supabase Table Editor by flipping beta_access to true.
