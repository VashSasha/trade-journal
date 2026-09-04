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
        create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
        create table auth.identities(id uuid primary key, user_id uuid references auth.users(id), provider text, provider_id text, created_at timestamptz default now());
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
        create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,
            plan text default 'free', discord_id text, email text, display_name text, beta_access boolean default false, updated_at timestamptz default now());`);
    await migration('0002_user_data');
    await migration('0004_ai_usage');
    await migration('0007_plan_sources');
    await migration('0009_billing');
    await migration('0016_owner_safe_trade_upsert');
    await migration('0017_billing_safety');
    await migration('0018_user_goals');
    await migration('0019_ai_request_reservations');
    await migration('0020_discord_entitlement_expiry');
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

    await db.exec('reset role');
    await query('insert into profiles(id) values ($1)', [A]);
    await setUser(A);
    await query("insert into goals(user_id,id,type,label,target,deadline,period) values ($1,$2,'monthly_pnl','August',100,now(),'month')", [A, token]);
    await setUser(B);
    assert.equal((await query('select * from goals')).length, 0);
    await assert.rejects(query("insert into goals(user_id,id,type,label,target,deadline,period) values ($1,$2,'monthly_pnl','Forged',100,now(),'month')", [A, other]), /row-level security/);
    await assert.rejects(query('select reserve_ai_request($1,$2)', [B, token]), /permission denied/);
    await assert.rejects(query('select effective_user_plan($1)', [A]), /permission denied/);
    await db.exec('reset role; set role service_role');

    const reserve = async (uid: string, id: string) => (await query('select reserve_ai_request($1,$2) as result', [uid, id]))[0].result;
    const finish = (uid: string, id: string, success: boolean) => query('select finish_ai_request($1,$2,$3)', [uid, id, success]);
    const count = async (uid: string) => (await query("select count from ai_usage where user_id=$1 and day=(now() at time zone 'UTC')::date", [uid]))[0].count;
    assert.equal(await reserve(A, token), 'reserved');
    assert.equal(await reserve(A, token), 'duplicate');
    assert.equal(await reserve(A, other), 'busy');
    await finish(A, token, false); await finish(A, token, false);
    assert.equal(await count(A), 0);
    for (let i = 0; i < 10; i++) {
        const id = crypto.randomUUID(); assert.equal(await reserve(A, id), 'reserved'); await finish(A, id, true);
        await finish(A, id, false); // A completed response can never be refunded.
    }
    assert.equal(await reserve(A, other), 'daily_limit');
    assert.equal(await count(A), 10);
    for (let i = 0; i < 30; i++) {
        const id = crypto.randomUUID(); assert.equal(await reserve(B, id), 'reserved'); await finish(B, id, false);
    }
    assert.equal(await count(B), 0);
    assert.equal(await reserve(B, other), 'attempt_limit');

    await db.exec('reset role');
    await query("insert into auth.identities(id,user_id,provider,provider_id) values ($1,$2,'discord','123456789012345678')", [token, A]);
    await query("update profiles set discord_id='123456789012345678', discord_plan='premium', discord_plan_expires_at=now()+interval '1 hour' where id=$1", [A]);
    const plan = async () => (await query('select effective_user_plan($1) as plan', [A]))[0].plan;
    assert.equal(await plan(), 'premium');
    await query("update profiles set discord_plan_expires_at=now()-interval '1 minute' where id=$1", [A]);
    assert.equal(await plan(), 'free');
    await query("update profiles set billing_plan='premium' where id=$1", [A]);
    assert.equal(await plan(), 'premium');
    await query("update profiles set plan_override='free' where id=$1", [A]);
    assert.equal(await plan(), 'free');
    await query("update profiles set plan_override=null,billing_plan=null,discord_plan_expires_at=now()+interval '1 hour' where id=$1", [A]);
    await query('delete from auth.identities where id=$1', [token]);
    assert.equal(await plan(), 'free'); // Unlinking cannot retain cached paid access.
    await setUser(B);
    assert.equal((await query('select * from get_my_entitlements()')).length, 1);
    assert.equal((await query('select plan from get_my_entitlements()'))[0].plan, 'free');
    await db.exec('reset role; create trigger test_signup after insert on auth.users for each row execute function handle_new_user()');
    const fakeUser = crypto.randomUUID();
    await query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [fakeUser, 'test@example.invalid',
        JSON.stringify({ provider_id: '123456789012345678', full_name: 'Test user' })]);
    const signup = (await query('select plan,discord_id,display_name from profiles where id=$1', [fakeUser]))[0];
    assert.equal(signup.discord_id, null);
    assert.equal(signup.plan, 'free');
    assert.equal(signup.display_name, 'Test user');
    console.log('PASS: goals RLS, AI reservations/refunds/limits, Discord expiry/identity/unlink, billing and override independence');
} finally { await db.close(); }
