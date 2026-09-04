// Disposable in-memory Postgres. No project secrets, live DB, or network calls.
// Run: npx deno run --no-lock --node-modules-dir=none --allow-read --allow-env scripts/test-database.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const migration = async (name: string) => db.exec(await Deno.readTextFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url)));
const query = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;
try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
        create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,
            plan text default 'free', discord_id text, updated_at timestamptz default now());`);
    await migration('0002_user_data');
    await migration('0007_plan_sources');
    await migration('0009_billing');
    await migration('0016_owner_safe_trade_upsert');
    await migration('0017_billing_safety');
    await db.exec(`grant usage on schema auth, public to authenticated, service_role;
        grant select,insert,update,delete on public.trades to authenticated;
        grant all on all tables in schema public to service_role;`);
    await query('insert into auth.users values ($1), ($2)', [A, B]);
    await query('insert into profiles(id) values ($1), ($2)', [A, B]);
    const setUser = async (id: string) => {
        await db.exec('reset role');
        await query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
        await db.exec('set role authenticated');
    };
    const trade = { id: 'local-1', user_id: A, symbol: 'NQ', asset_type: 'futures', direction: 'long',
        entry_date: '2026-08-01T10:00:00.000Z', exit_date: '2026-08-01T10:01:00.000Z',
        entry_price: 100, exit_price: 101, quantity: 1, pnl: 20, account_id: '123', source: 'tradovate', external_id: 'fill-1',
        status: 'closed', notes: 'Keep my journal', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const save = (rows: unknown[]) => query('select * from upsert_user_trades($1::jsonb)', [JSON.stringify(rows)]);
    await setUser(A);
    await save([trade]);
    const replay = await save([{ ...trade, id: 'different-tab-id', notes: 'Do not overwrite' }]);
    assert.equal(replay[0].id, 'local-1');
    assert.equal(replay[0].notes, 'Keep my journal');
    assert.equal((await query('select count(*)::int as n from trades'))[0].n, 1);
    await assert.rejects(save([{ ...trade, user_id: B }]), /owner mismatch/);
    await assert.rejects(save([{ ...trade, id: 'html', external_id: 'perf_2026-08-01T10:00:00.000Z' }]), /cross-format duplicate/);
    await setUser(B);
    assert.equal((await query('select * from trades')).length, 0);
    await assert.rejects(query('select acquire_billing_operation($1,$2)', [B, token]), /permission denied/);
    await db.exec('reset role; set role service_role');
    await query('insert into billing(user_id,stripe_customer_id) values ($1,$2)', [A, 'cus_test']);
    assert.equal((await query('select acquire_billing_operation($1,$2) as locked', [A, token]))[0].locked, true);
    assert.equal((await query('select acquire_billing_operation($1,$2) as locked', [A, other]))[0].locked, false);
    const apply = (id: string, status: string, lock = token) => query(
        'select apply_billing_snapshot($1,$2,$3,$4,$5,$6,$7,$8)', [A, lock, id, 'cus_test', 'sub_test', status, 'price_test', null]);
    await assert.rejects(apply('evt_bad_lock', 'active', other), /expired/);
    await apply('evt_1', 'active');
    assert.equal((await query('select plan from profiles where id=$1', [A]))[0].plan, 'premium');
    await apply('evt_1', 'canceled'); // Replay must do nothing.
    assert.equal((await query('select plan from profiles where id=$1', [A]))[0].plan, 'premium');
    await query('delete from profiles where id=$1', [A]);
    await assert.rejects(apply('evt_atomic', 'canceled'), /Profile missing/);
    assert.equal((await query('select status from billing where user_id=$1', [A]))[0].status, 'active');
    assert.equal((await query("select * from billing_events where event_id='evt_atomic'")).length, 0);
    console.log('PASS: migrations, owner isolation, duplicate retry, cross-format guard, billing locks, event replay, atomic rollback');
} finally { await db.close(); }
