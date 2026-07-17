-- Denormalize identity into profiles so admin work in the Table Editor
-- doesn't require cross-referencing UUIDs against auth.users.
-- No RLS changes: the existing select-own policy covers the new columns,
-- and users still cannot write to profiles at all.

alter table public.profiles
    add column email text,
    add column display_name text;

-- Backfill existing users from auth.users.
update public.profiles p
set email = u.email,
    display_name = coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        u.raw_user_meta_data ->> 'user_name',
        split_part(u.email, '@', 1)
    )
from auth.users u
where u.id = p.id;

-- New signups get identity copied automatically (replaces the 0001 version).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, discord_id, email, display_name)
    values (
        new.id,
        new.raw_user_meta_data ->> 'provider_id',
        new.email,
        coalesce(
            new.raw_user_meta_data ->> 'full_name',
            new.raw_user_meta_data ->> 'name',
            new.raw_user_meta_data ->> 'user_name',
            split_part(new.email, '@', 1)
        )
    );
    return new;
end;
$$;
