-- Collapse archived + active into a single active flag.
-- Accounts the user manually archived are now permanently inactive (active = false).
-- The archived column is dropped after the data migration so the DB and
-- the application model stay in sync.

update public.trading_accounts
    set active = false
    where archived = true;

alter table public.trading_accounts
    drop column if exists archived;
