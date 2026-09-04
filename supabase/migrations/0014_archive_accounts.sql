-- User-controlled archive flag for dead broker accounts.
--
-- `active` is the broker-reported flag, captured at last fetch — a sync
-- can and will reset it. `archived` is the USER's override; a sync must
-- never touch it (the upsert in TradingAccountsService always writes the
-- full row including the current archived value so it is preserved).
--
-- Run via the Supabase SQL editor.

alter table public.trading_accounts
    add column if not exists archived boolean not null default false;
