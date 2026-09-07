-- Private, account-synced custom alert audio. Binary files live in Supabase
-- Storage; this table contains only the small validated metadata needed by the
-- settings UI. Browser IndexedDB remains a non-authoritative playback cache.
begin;

create table public.custom_alert_sounds (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind text not null check (kind in ('open', 'close', 'target', 'risk')),
    file_name text not null check (length(file_name) between 1 and 100),
    mime_type text not null check (mime_type in (
        'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/ogg',
        'audio/wav', 'audio/wave', 'audio/webm', 'audio/x-m4a', 'audio/x-wav'
    )),
    size_bytes integer not null check (size_bytes between 1 and 3145728),
    duration_seconds numeric not null check (duration_seconds > 0 and duration_seconds <= 10),
    updated_at timestamptz not null default now(),
    primary key (user_id, kind)
);

alter table public.custom_alert_sounds enable row level security;

create trigger custom_alert_sounds_set_updated_at
    before update on public.custom_alert_sounds
    for each row execute function public.set_updated_at();

create policy "Owners read custom alert sound metadata" on public.custom_alert_sounds
    for select to authenticated
    using (user_id = (select auth.uid()));
create policy "Owners create custom alert sound metadata" on public.custom_alert_sounds
    for insert to authenticated
    with check (user_id = (select auth.uid()));
create policy "Owners update custom alert sound metadata" on public.custom_alert_sounds
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));
create policy "Owners delete custom alert sound metadata" on public.custom_alert_sounds
    for delete to authenticated
    using (user_id = (select auth.uid()));

revoke all on public.custom_alert_sounds from anon;
grant select, insert, update, delete on public.custom_alert_sounds to authenticated;
grant all on public.custom_alert_sounds to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'custom-alert-sounds',
    'custom-alert-sounds',
    false,
    3145728,
    array[
        'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/ogg',
        'audio/wav', 'audio/wave', 'audio/webm', 'audio/x-m4a', 'audio/x-wav'
    ]::text[]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Objects use one fixed path per cue: <authenticated UUID>/<cue>. Checking
-- both owner_id and that exact path prevents users from reading or replacing
-- another account's audio, even if they guess its UUID.
create policy "Owners read custom alert sound files" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'custom-alert-sounds'
        and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and storage.filename(name) in ('open', 'close', 'target', 'risk')
    );
create policy "Owners upload custom alert sound files" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'custom-alert-sounds'
        and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and storage.filename(name) in ('open', 'close', 'target', 'risk')
    );
create policy "Owners replace custom alert sound files" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'custom-alert-sounds'
        and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and storage.filename(name) in ('open', 'close', 'target', 'risk')
    )
    with check (
        bucket_id = 'custom-alert-sounds'
        and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and storage.filename(name) in ('open', 'close', 'target', 'risk')
    );
create policy "Owners delete custom alert sound files" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'custom-alert-sounds'
        and owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and array_length(storage.foldername(name), 1) = 1
        and storage.filename(name) in ('open', 'close', 'target', 'risk')
    );

comment on table public.custom_alert_sounds is
    'Owner-only metadata for private custom alert audio stored in the custom-alert-sounds bucket.';

commit;
