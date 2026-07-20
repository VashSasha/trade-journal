-- Billing: Stripe subscription state for the journal-only plan. One row per
-- user, written ONLY by the service role (the stripe-webhook Edge Function).
-- The effective `profiles.plan` is still derived by the 0007 trigger from the
-- billing_plan / discord_plan / plan_override sources — the webhook flips
-- profiles.billing_plan to 'premium' while a subscription is active/trialing
-- and back to null otherwise, so it never clobbers a Discord plan or an admin
-- override.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).

-- ── table ─────────────────────────────────────────────────────────────────
-- user_id is the PK and FKs auth.users(id) ON DELETE CASCADE so deleting an
-- account (delete-account) also removes its billing row.
create table if not exists public.billing (
    user_id                uuid primary key references auth.users(id) on delete cascade,
    stripe_customer_id     text,
    stripe_subscription_id text,
    status                 text,
    price_id               text,
    current_period_end     timestamptz,
    updated_at             timestamptz default now()
);

-- Webhook lookups resolve a user by Stripe's customer / subscription id (the
-- customer.subscription.* events carry no user_id), so index both.
create index if not exists billing_stripe_customer_id_idx
    on public.billing (stripe_customer_id);
create index if not exists billing_stripe_subscription_id_idx
    on public.billing (stripe_subscription_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Owner can SELECT their own row (to show status on /account). There is NO
-- client insert / update / delete policy, so with RLS enabled the browser
-- (anon / authenticated key) can only read — never write. The service-role
-- key used by the webhook bypasses RLS entirely and is the only writer.
alter table public.billing enable row level security;

drop policy if exists "billing_select_own" on public.billing;
create policy "billing_select_own"
    on public.billing
    for select
    using (auth.uid() = user_id);
