-- Additive migration: no existing trades/accounts are deleted.
-- Serialize idempotent broker imports for ONE user; retain canonical IDs and notes
-- when two tabs have generated different local IDs for the same external fill.
create or replace function public.upsert_user_trades(p_rows jsonb)
returns setof public.trades
language plpgsql security invoker set search_path = ''
as $$
declare item jsonb; incoming public.trades; saved public.trades; owner_id uuid := auth.uid();
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
        raise exception 'Expected at most 500 trades';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 16));
    for item in select value from jsonb_array_elements(p_rows) loop
        if (item->>'user_id')::uuid is distinct from owner_id then
            raise exception 'Trade owner mismatch';
        end if;
        incoming := jsonb_populate_record(null::public.trades, item);
        if incoming.external_id is not null then
            select * into saved from public.trades
                where user_id = owner_id and external_id = incoming.external_id;
            if found and saved.id <> incoming.id then
                return next saved;
                continue;
            end if;
        end if;
        if incoming.source = 'tradovate' and exists (
            select 1 from public.trades t where t.user_id = owner_id and t.id <> incoming.id
                and t.source = 'tradovate' and t.account_id = incoming.account_id
                and t.symbol = incoming.symbol and t.direction = incoming.direction
                and t.quantity = incoming.quantity and t.entry_date = incoming.entry_date
                and t.exit_date = incoming.exit_date and t.entry_price = incoming.entry_price
                and t.exit_price = incoming.exit_price and t.pnl = incoming.pnl
                and (t.external_id ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    or incoming.external_id ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}T')
        ) then raise exception 'Possible cross-format duplicate requires review'; end if;
        insert into public.trades select (incoming).*
        on conflict (user_id, id) do update set
            symbol = excluded.symbol,
            asset_type = excluded.asset_type,
            direction = excluded.direction,
            entry_date = excluded.entry_date,
            entry_time = excluded.entry_time,
            entry_price = excluded.entry_price,
            quantity = excluded.quantity,
            exit_date = excluded.exit_date,
            exit_time = excluded.exit_time,
            exit_price = excluded.exit_price,
            fees = excluded.fees,
            multiplier = excluded.multiplier,
            pnl = excluded.pnl,
            pnl_percent = excluded.pnl_percent,
            net_pnl = excluded.net_pnl,
            setup = excluded.setup,
            playbook_id = excluded.playbook_id,
            tags = excluded.tags,
            emotions = excluded.emotions,
            grade = excluded.grade,
            mistakes = excluded.mistakes,
            went_well = excluded.went_well,
            to_improve = excluded.to_improve,
            source = excluded.source,
            external_id = excluded.external_id,
            connection_id = excluded.connection_id,
            account_id = excluded.account_id,
            account_name = excluded.account_name,
            notes = excluded.notes,
            screenshots = excluded.screenshots,
            status = excluded.status,
            updated_at = excluded.updated_at
        returning * into saved;
        return next saved;
    end loop;
end;
$$;
revoke all on function public.upsert_user_trades(jsonb) from public, anon;
grant execute on function public.upsert_user_trades(jsonb) to authenticated;
