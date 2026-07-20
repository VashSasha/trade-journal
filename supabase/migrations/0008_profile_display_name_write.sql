-- Let users edit their own display_name from the Account page — and NOTHING
-- else on profiles. RLS gates the ROW; column privileges gate the COLUMNS.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).
--
-- Security: plan, discord_plan, billing_plan, plan_override, beta_access,
-- email, discord_id must stay server-only (0001 / 0007). A row-only UPDATE
-- policy alone would expose every column, so we also revoke table-wide UPDATE
-- from `authenticated` and grant it back for display_name only.

-- Owner may update their own profile row...
create policy "Users update own profile"
    on public.profiles
    for update
    to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- ...but only the display_name column. Any UPDATE touching another column is
-- rejected at the privilege layer ("permission denied for column ..."), so the
-- effective plan and its sources remain derived/server-set, never client-set.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
