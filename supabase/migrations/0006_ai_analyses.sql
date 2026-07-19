-- Saved AI day-analyses. Users generate a streamed markdown analysis for a
-- journal day and can persist it here to revisit later.
--
-- Run this via the Supabase SQL editor (same as the earlier migrations).
--
-- Owner-scoped like every other table: RLS enabled, all four operations
-- restricted to user_id = auth.uid(), and user_id defaults to auth.uid() so
-- clients never send (or spoof) it — matching 0002_user_data.sql exactly.

create table public.ai_analyses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

    date text not null,        -- YYYY-MM-DD the analysis is about
    content text not null,     -- the saved markdown

    created_at timestamptz not null default now()
);

-- Day-scoped lookups (list a day's saved analyses). Intentionally NOT unique:
-- a user may generate and save several analyses for the same day.
create index ai_analyses_user_date_idx on public.ai_analyses (user_id, date);

alter table public.ai_analyses enable row level security;

create policy "Users select own ai analyses" on public.ai_analyses
    for select to authenticated using (user_id = auth.uid());
create policy "Users insert own ai analyses" on public.ai_analyses
    for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own ai analyses" on public.ai_analyses
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own ai analyses" on public.ai_analyses
    for delete to authenticated using (user_id = auth.uid());
