-- Fail safely if old data contains duplicate customers: reconcile those rows
-- manually before retrying this migration. Never delete billing associations.
begin;
create unique index if not exists billing_unique_customer on public.billing(stripe_customer_id)
    where stripe_customer_id is not null;
alter table public.billing
    add column if not exists checkout_attempt uuid,
    add column if not exists checkout_price_id text,
    add column if not exists checkout_session_id text,
    add column if not exists deletion_pending boolean not null default false;

create table public.billing_operations (
    user_id uuid primary key references auth.users(id) on delete cascade,
    token uuid not null,
    expires_at timestamptz not null
);
create table public.billing_events (
    event_id text primary key,
    processed_at timestamptz not null default now()
);
-- Retain only a Stripe customer identifier to safely acknowledge late events
-- after account deletion. No user ID, email, or trading data in tombstones.
create table public.deleted_billing_customers (
    customer_id text primary key,
    deleted_at timestamptz not null default now()
);
alter table public.billing_operations enable row level security;
alter table public.billing_events enable row level security;
alter table public.deleted_billing_customers enable row level security;
revoke all on public.billing_operations, public.billing_events, public.deleted_billing_customers from public, anon, authenticated;
grant all on public.billing_operations, public.billing_events, public.deleted_billing_customers to service_role;

create function public.acquire_billing_operation(p_user_id uuid, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
    insert into public.billing_operations values (p_user_id, p_token, now() + interval '5 minutes')
    on conflict(user_id) do update set token = excluded.token, expires_at = excluded.expires_at
        where public.billing_operations.expires_at < now();
    return found;
end;
$$;

create function public.apply_billing_snapshot(
    p_user_id uuid, p_token uuid, p_event_id text, p_customer_id text,
    p_subscription_id text, p_status text, p_price_id text, p_period_end timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
begin
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
            then 'premium' else null end, updated_at = now() where id = p_user_id;
        if not found then raise exception 'Profile missing'; end if;
    insert into public.billing_events(event_id) values (p_event_id);
end;
$$;
revoke all on function public.acquire_billing_operation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_billing_snapshot(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.acquire_billing_operation(uuid, uuid) to service_role;
grant execute on function public.apply_billing_snapshot(uuid, uuid, text, text, text, text, text, timestamptz) to service_role;
commit;
