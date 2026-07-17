-- Per-user daily AI usage, written ONLY by the ai-report Edge Function
-- (service role — bypasses RLS). Clients may read their own rows so the UI
-- can show remaining quota, and nothing else.

create table public.ai_usage (
    user_id uuid not null references auth.users (id) on delete cascade,
    day date not null,
    count int not null default 0,
    primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

create policy "Users view own AI usage"
    on public.ai_usage
    for select
    to authenticated
    using (user_id = auth.uid());

-- Deliberately NO insert/update/delete policies: only the Edge Function
-- (service role) may write, via the atomic counter below.

-- Insert-or-increment in one statement so concurrent requests can't race
-- past the limit. Returns the NEW count; the Edge Function rejects with 429
-- when it exceeds the daily cap.
create function public.increment_ai_usage(p_user_id uuid)
returns integer
language sql
set search_path = ''
as $$
    insert into public.ai_usage (user_id, day, count)
    values (p_user_id, current_date, 1)
    on conflict (user_id, day)
    do update set count = public.ai_usage.count + 1
    returning count;
$$;

-- Clients must not be able to burn quota (or probe it) directly.
revoke execute on function public.increment_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid) to service_role;
