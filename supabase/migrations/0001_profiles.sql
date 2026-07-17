-- Profiles: one row per auth user, holding the server-resolved plan.
-- Plan is ONLY ever written by the resolve-plan Edge Function (secret key);
-- clients can read their own row and nothing else.

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    discord_id text,
    plan text not null default 'free' check (plan in ('free', 'premium', 'lifetime')),
    updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Users may read their own profile only.
create policy "Users can view own profile"
    on public.profiles
    for select
    to authenticated
    using (id = auth.uid());

-- Deliberately NO insert/update/delete policies for regular users:
-- rows are created by the trigger below (runs as definer) and plan is
-- updated exclusively by the Edge Function using the secret key.

-- Auto-create a profile when a user signs up, copying the Discord provider
-- id from the OAuth metadata (null for email/password users).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, discord_id)
    values (new.id, new.raw_user_meta_data ->> 'provider_id');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
