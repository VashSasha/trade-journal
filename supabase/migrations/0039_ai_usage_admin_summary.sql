-- Admin overview: one row per user, not one row per user/day.
-- Run this whole file in the Supabase SQL editor as postgres.
-- No tables, usage records, request ledgers, or quota functions are changed.
begin;

-- The existing dashboard-created view has day/count columns. PostgreSQL cannot
-- remove/rename those columns with CREATE OR REPLACE VIEW, so replace only the
-- view definition inside this transaction. Deliberately NO CASCADE: if another
-- object depends on the old view (or this name is a table), stop safely instead.
drop view if exists public.ai_usage_admin;

create view public.ai_usage_admin
with (security_invoker = true)
as
with usage_by_user as (
    select
        user_id,
        coalesce(sum(count) filter (
            where day = (now() at time zone 'UTC')::date
        ), 0) as today_count,
        sum(count) as total_count,
        max(day) filter (where count > 0) as last_usage_day
    from public.ai_usage
    group by user_id
)
select
    coalesce(p.id, u.user_id) as user_id,
    p.email,
    p.display_name,
    coalesce(u.today_count, 0) as today_count,
    coalesce(u.total_count, 0) as total_count,
    u.last_usage_day
from public.profiles p
-- Include unused profiles with zero counts, and retain visibility of usage
-- whose profile is missing. Group on user ID, never on mutable names/emails.
full join usage_by_user u on u.user_id = p.id;

-- Names/emails and cross-user totals are for dashboard admins/server use only.
-- Revoke any default grants as well as grants from the previous definition.
revoke all on public.ai_usage_admin from public, anon, authenticated;
grant select on public.ai_usage_admin to service_role;

comment on view public.ai_usage_admin is
    'Admin-only AI report quota summary, one row per user. Today uses UTC. Totals include charged/reserved usage after refunds; Live Coach has a separate quota. Daily history remains in ai_usage.';
comment on column public.ai_usage_admin.last_usage_day is
    'Latest UTC day with positive charged usage; null for users with no charged usage. Not a precise last-request timestamp.';

notify pgrst, 'reload schema';
commit;
