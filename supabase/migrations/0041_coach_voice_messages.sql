-- Voice transcripts share the existing private conversation; no raw audio is stored.
begin;
create table if not exists public.coach_voice_messages (
    user_id uuid not null,
    conversation_id uuid not null,
    session_id uuid not null,
    item_id text not null check (char_length(item_id) between 1 and 150),
    role text not null check (role in ('user', 'assistant')),
    content text not null check (char_length(content) between 1 and 4000),
    interrupted boolean not null default false,
    context jsonb not null check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 16000),
    created_at timestamptz not null default now(),
    primary key (user_id, session_id, item_id),
    foreign key (user_id, conversation_id) references public.coach_conversations(user_id, id) on delete cascade
);
create index if not exists coach_voice_messages_conversation_idx
    on public.coach_voice_messages(user_id, conversation_id, created_at, item_id);
alter table public.coach_voice_messages enable row level security;
drop policy if exists coach_voice_messages_select on public.coach_voice_messages;
create policy coach_voice_messages_select on public.coach_voice_messages
    for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.coach_voice_messages from public, anon, authenticated;
grant select on public.coach_voice_messages to authenticated;
grant all on public.coach_voice_messages to service_role;
comment on table public.coach_voice_messages is
    'Provider-observed voice transcripts, written only by the authenticated voice server. Interrupted assistant text is omitted rather than claiming unplayed words were heard. No audio recordings.';
notify pgrst, 'reload schema';
commit;
