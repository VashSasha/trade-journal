-- Add optional per-account opening balance.
-- NULL until explicitly set (most accounts derive it as currentBalance − ΣP&L).
-- Never used for auth or RLS — purely display metadata.
ALTER TABLE public.trading_accounts
    ADD COLUMN IF NOT EXISTS starting_balance numeric;
