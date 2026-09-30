-- Private typed Coach conversations, separate from automatic observation history.
begin;
create table if not exists public.coach_conversations (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null,
    title text not null check (char_length(title) between 1 and 100),
    created_at timestamptz not null default now(),
    primary key (user_id, id)
);
create table if not exists public.coach_chat_turns (
    user_id uuid not null,
    id uuid not null,
    conversation_id uuid not null,
    prompt text not null check (char_length(prompt) between 1 and 1000),
    answer jsonb not null check (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 6000),
    context jsonb not null check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 16000),
    created_at timestamptz not null default now(),
    primary key (user_id, id),
    foreign key (user_id, conversation_id) references public.coach_conversations(user_id, id) on delete cascade
);
create index if not exists coach_conversations_recent_idx on public.coach_conversations(user_id, created_at desc, id desc);
create index if not exists coach_chat_turns_conversation_idx on public.coach_chat_turns(user_id, conversation_id, created_at, id);
alter table public.coach_conversations enable row level security;
alter table public.coach_chat_turns enable row level security;
drop policy if exists coach_conversations_select on public.coach_conversations;
create policy coach_conversations_select on public.coach_conversations for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists coach_conversations_insert on public.coach_conversations;
create policy coach_conversations_insert on public.coach_conversations for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists coach_conversations_delete on public.coach_conversations;
create policy coach_conversations_delete on public.coach_conversations for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists coach_chat_turns_select on public.coach_chat_turns;
create policy coach_chat_turns_select on public.coach_chat_turns for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.coach_conversations, public.coach_chat_turns from public, anon, authenticated;
grant select, insert, delete on public.coach_conversations to authenticated;
grant select on public.coach_chat_turns to authenticated;
-- Replies/history roles are written only by the authenticated, entitlement-checked AI function.
grant all on public.coach_conversations, public.coach_chat_turns to service_role;
comment on table public.coach_chat_turns is 'Completed typed Coach exchanges. Context is a bounded client snapshot of saved trades, not live broker data or an authoritative ledger. No audio or credentials.';
notify pgrst, 'reload schema';
commit;
