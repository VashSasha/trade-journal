// Disposable in-memory Postgres. No project secrets, live DB, or network calls.
// Run: npx deno run --no-lock --node-modules-dir=none --allow-read --allow-env scripts/test-database.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
import { COACH_AI_VOICES } from '../supabase/functions/_shared/coach-voices.ts';
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
    await migration('0023_session_sound_preferences');
    await migration('0024_account_alert_preferences');
    await migration('0025_live_coach_preferences');
    await migration('0026_live_coach_ai');
    await migration('0027_live_coach_voice');
    await db.exec(`grant usage on schema auth, public to authenticated, service_role;
        grant select,insert,update,delete on public.trades to authenticated;
        grant select,insert,update on public.user_settings to authenticated;
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
    await query('select set_my_session_sound_preferences($1::jsonb)', [JSON.stringify({
        volume: 55, opens: true, closes: false, armed: true,
    })]);
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['market_event_alerts', JSON.stringify({
        enabled: true, leadMinutes: 30, highOnly: false, desktopNotifications: true,
    })]);
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['performance_alerts', JSON.stringify({
        dailyProfit: { enabled: true, value: 500 }, dailyLoss: { enabled: false, value: 300 },
        weeklyProfit: { enabled: false, value: 1500 }, weeklyLoss: { enabled: true, value: 750 },
        dailyTrades: { enabled: true, value: 8 },
    })]);
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify({
        enabled: true, aiCommentary: true, entries: true, sizing: true, exits: true, guardrails: true,
        cooldownSeconds: 10, speechRate: 1,
    })]);
    const alertPrefs = (await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs;
    assert.equal(alertPrefs.session_sounds.volume, 55);
    assert.equal(alertPrefs.market_event_alerts.leadMinutes, 30);
    assert.equal(alertPrefs.market_event_alerts.desktopNotifications, undefined);
    assert.equal(alertPrefs.performance_alerts.dailyTrades.value, 8);
    assert.equal(alertPrefs.live_coach.enabled, true);
    assert.equal(alertPrefs.live_coach.aiCommentary, true);
    assert.equal(alertPrefs.live_coach.voice, 'browser');
    const voicePrefs = { ...alertPrefs.live_coach, voice: 'cedar' };
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify(voicePrefs)]);
    delete voicePrefs.voice;
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify(voicePrefs)]);
    assert.equal((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs.live_coach.voice, 'cedar');
    await assert.rejects(query('select set_my_account_alert_preferences($1,$2::jsonb)',
        ['live_coach', JSON.stringify({ ...voicePrefs, voice: 'unknown' })]), /Unsupported Coach voice/);

    const beforeVoiceMigration = (await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs;
    await db.exec('reset role');
    await migration('0028_live_coach_voice_options');
    await migration('0028_live_coach_voice_options'); // Safe to re-run; no saved choices are rewritten.
    await setUser(A);
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, beforeVoiceMigration);
    for (const voice of [...COACH_AI_VOICES, 'browser']) {
        await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify({ ...voicePrefs, voice })]);
        await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify(voicePrefs)]);
        assert.equal((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs.live_coach.voice, voice);
    }
    // Simulate old preferences with no selected voice; unrelated preferences survive the new default.
    await query("update user_settings set prefs=jsonb_set(prefs, '{live_coach}', (prefs->'live_coach') - 'voice') where user_id=$1", [A]);
    await query('select set_my_account_alert_preferences($1,$2::jsonb)', ['live_coach', JSON.stringify(voicePrefs)]);
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, beforeVoiceMigration);
    for (const voice of ['untrusted', null, { id: 'custom_voice' }]) {
        await assert.rejects(query('select set_my_account_alert_preferences($1,$2::jsonb)',
            ['live_coach', JSON.stringify({ ...voicePrefs, voice })]), /Unsupported Coach voice/);
    }
    await assert.rejects(
        query('select set_my_account_alert_preferences($1,$2::jsonb)', [
            'market_event_alerts', JSON.stringify({ enabled: true, leadMinutes: 7, highOnly: true }),
        ]),
        /Unsupported market-event lead time/,
    );
    await assert.rejects(
        query('select set_my_account_alert_preferences($1,$2::jsonb)', [
            'live_coach', JSON.stringify({
                enabled: true, aiCommentary: true, entries: true, sizing: true, exits: true, guardrails: true,
                cooldownSeconds: 1, speechRate: 1,
            }),
        ]),
        /Live Coach cooldown/,
    );
    await setUser(B);
    assert.equal((await query('select * from user_settings')).length, 0);
    await setUser(A);
    await db.exec('reset role');
    await migration('0029_session_schedule_preferences');
    await migration('0029_session_schedule_preferences');
    await setUser(A);
    const schedulePrefs = {
        asia: { enabled: false, openMinute: 1020, closeMinute: 120 },
        london: { enabled: true, openMinute: 480, closeMinute: 1020 },
        'new-york': { enabled: true, openMinute: 570, closeMinute: 960 },
    };
    const saveSchedule = (prefs: unknown) => query('select set_my_account_alert_preferences($1,$2::jsonb)', ['session_schedule', JSON.stringify(prefs)]);
    await saveSchedule(schedulePrefs);
    const withSchedule = (await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs;
    assert.deepEqual(withSchedule.session_schedule, schedulePrefs);
    assert.deepEqual(withSchedule.live_coach, beforeVoiceMigration.live_coach);
    assert.equal(withSchedule.session_sounds.volume, 55);
    for (const hours of [{ openMinute: -1 }, { closeMinute: 1440 }, { openMinute: 120 }, { openMinute: 1.5 }, { enabled: 'yes' }]) {
        await assert.rejects(saveSchedule({ ...schedulePrefs, asia: { ...schedulePrefs.asia, ...hours } }), /Invalid session/);
    }
    await assert.rejects(saveSchedule({ asia: schedulePrefs.asia }), /Invalid session/);
    await setUser(B);
    assert.equal((await query('select * from user_settings')).length, 0);
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
    await assert.rejects(query('select reserve_live_coach_ai_request($1,$2)', [B, token]), /permission denied/);
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

    const coachReserve = async (uid: string, id: string) =>
        (await query('select reserve_live_coach_ai_request($1,$2) as result', [uid, id]))[0].result;
    const coachFinish = (uid: string, id: string, success: boolean) =>
        query('select finish_live_coach_ai_request($1,$2,$3)', [uid, id, success]);
    assert.equal(await coachReserve(A, token), 'reserved');
    assert.equal(await coachReserve(A, token), 'duplicate');
    assert.equal(await coachReserve(A, other), 'busy');
    await coachFinish(A, token, false);
    assert.equal((await query('select count from live_coach_ai_usage where user_id=$1', [A]))[0].count, 0);
    await query(`insert into live_coach_ai_usage(user_id,day,count)
        values ($1,(now() at time zone 'UTC')::date,30)
        on conflict (user_id,day) do update set count=30`, [B]);
    assert.equal(await coachReserve(B, other), 'daily_limit');

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

    // Premium+ migration is additive: preserve trades, settings, and explicit plan sources.
    const tradesBeforePlus = await query('select * from trades order by id');
    const prefsBeforePlus = await query('select * from user_settings order by user_id');
    await query("update profiles set billing_plan=null,discord_plan=null,plan_override='lifetime' where id=$1", [A]);
    await migration('0032_premium_plus');
    await migration('0032_premium_plus');
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    assert.deepEqual(await query('select * from user_settings order by user_id'), prefsBeforePlus);
    const ai = async () => (await query('select effective_user_ai_access($1) as allowed', [A]))[0].allowed;
    assert.equal(await plan(), 'lifetime');
    assert.equal(await ai(), false); // No grandfathering, including existing Lifetime.
    for (const tier of ['free', 'premium', 'lifetime', 'premium_plus', 'admin']) {
        await query('update profiles set plan_override=$2,ai_access_override=null where id=$1', [A, tier]);
        assert.equal(await ai(), ['premium_plus', 'admin'].includes(tier));
        await query('update profiles set ai_access_override=true where id=$1', [A]);
        assert.equal(await ai(), true);
        assert.equal(await plan(), tier); // AI grants do not change base entitlements.
        await query('update profiles set ai_access_override=false where id=$1', [A]);
        assert.equal(await ai(), false);
    }
    await query("update profiles set plan_override=null,ai_access_override=null,billing_plan='premium_plus',discord_plan='lifetime',discord_plan_expires_at=now()+interval '1 hour' where id=$1", [A]);
    await query("insert into auth.identities(id,user_id,provider,provider_id) values ($1,$2,'discord','123456789012345678')", [token, A]);
    assert.equal(await plan(), 'premium_plus');
    assert.equal(await ai(), true);
    await query('update profiles set billing_plan=null where id=$1', [A]);
    assert.equal(await plan(), 'lifetime');
    assert.equal(await ai(), false);
    await query("update profiles set discord_plan='premium_plus' where id=$1", [A]);
    assert.equal(await ai(), true);
    await query("update profiles set discord_plan_expires_at=now()-interval '1 minute' where id=$1", [A]);
    assert.equal(await ai(), false);
    await query("update profiles set discord_plan_expires_at=now()+interval '1 hour' where id=$1", [A]);
    await query("update auth.identities set provider_id='different' where id=$1", [token]);
    assert.equal(await ai(), false);

    await query("update profiles set plan_override='premium_plus',ai_access_override=true where id=$1", [A]);
    await setUser(B);
    assert.equal((await query('select * from get_my_entitlements()'))[0].ai_access, false);
    for (const column of ['ai_access_override', 'plan_override', 'billing_plan', 'discord_plan']) {
        await assert.rejects(query(`update profiles set ${column}=null where id=$1`, [B]), /permission denied/);
    }
    await assert.rejects(query('select effective_user_ai_access($1)', [A]), /permission denied/);
    await assert.rejects(query('select apply_billing_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [B, token, 'forged', 'cus_test', 'sub_test', 'active', 'price_test', null, 'premium_plus']), /permission denied/);
    await setUser(A);
    assert.equal((await query('select * from get_my_entitlements()'))[0].ai_access, true);
    await db.exec('reset role; set role anon');
    await assert.rejects(query('select * from get_my_entitlements()'), /permission denied/);
    await db.exec('reset role; set role service_role');
    await query('update profiles set plan_override=null,discord_plan=null,ai_access_override=null where id=$1', [A]);
    await query("update billing_operations set expires_at=now()+interval '5 minutes' where user_id=$1", [A]);
    const applyPlus = (event: string, tier: string | null, status = 'active', lock = token) => query(
        'select apply_billing_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [A, lock, event, 'cus_test', 'sub_test', status, 'price_test', null, tier]);
    await assert.rejects(applyPlus('evt_plus_bad_lock', 'premium_plus', 'active', other), /expired/);
    await assert.rejects(applyPlus('evt_plus_unknown', null), /Unrecognized paid plan/);
    await assert.rejects(applyPlus('evt_plus_forged', 'admin'), /Unrecognized paid plan/);
    await applyPlus('evt_plus_upgrade', 'premium_plus');
    assert.equal(await ai(), true);
    await applyPlus('evt_plus_upgrade', 'premium'); // Receipt makes replay inert.
    assert.equal(await plan(), 'premium_plus');
    await applyPlus('evt_plus_downgrade', 'premium');
    assert.equal(await plan(), 'premium');
    assert.equal(await ai(), false);
    await query("update profiles set plan_override='lifetime',ai_access_override=true where id=$1", [A]);
    await applyPlus('evt_plus_cancel', null, 'canceled');
    assert.equal(await plan(), 'lifetime');
    assert.equal(await ai(), true); // Cancellation must not erase an independent admin grant.
    assert.equal((await query("select * from pg_proc where proname='apply_billing_snapshot' and pronargs=8")).length, 0);
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    console.log('PASS: Premium+ tiers, explicit AI grants/revocation, owner-only access, source precedence, safe rerun, billing upgrade/downgrade/cancel/replay, retained trading data');

    await db.exec('reset role');
    await migration('0033_live_coach_history');
    await migration('0033_live_coach_history');
    await setUser(A);
    const historyInsert = `insert into live_coach_history(id, observed_at, trade_date, title, content)
        values ($1, '2026-09-28T15:00:00Z', '2026-09-28', 'Position opened', 'Opened one contract')
        on conflict (user_id,id) do nothing`;
    await query(historyInsert, [token]);
    await query(historyInsert, [token]);
    assert.equal((await query('select count(*)::int n from live_coach_history'))[0].n, 1);
    const followUp = JSON.stringify({ meaning: 'Copied entry', evidence: 'Five accounts', nextStep: 'Review the plan' });
    await query('update live_coach_history set explanation=$1::jsonb where id=$2', [followUp, token]);
    await query('update live_coach_history set session_comparison=$1::jsonb where id=$2', [followUp, token]);
    assert.equal((await query('select explanation from live_coach_history'))[0].explanation.meaning, 'Copied entry');
    for (const column of ['user_id', 'content', 'snapshot', 'trade_date', 'observed_at']) {
        await assert.rejects(query(`update live_coach_history set ${column}=${column} where id=$1`, [token]), /permission denied/);
    }
    await assert.rejects(query('update live_coach_history set explanation=$1::jsonb', [JSON.stringify('bad')]), /check constraint/);
    await setUser(B);
    assert.equal((await query('select * from live_coach_history')).length, 0);
    assert.equal((await query('update live_coach_history set explanation=null where user_id=$1 returning id', [A])).length, 0);
    assert.equal((await query('delete from live_coach_history where user_id=$1 returning id', [A])).length, 0);
    await assert.rejects(query(`insert into live_coach_history(user_id,id,observed_at,trade_date,title,content)
        values ($1,$2,now(),current_date,'Forged','Not allowed')`, [A, other]), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(query('select * from live_coach_history'), /permission denied/);
    await assert.rejects(query(historyInsert, [other]), /permission denied/);
    await db.exec('reset role');
    await query("update profiles set plan_override='free',ai_access_override=false where id=$1", [A]);
    await setUser(A);
    assert.equal((await query('select * from live_coach_history')).length, 1); // History survives downgrade.
    await query('delete from live_coach_history where id=$1', [token]);
    assert.equal((await query('select * from live_coach_history')).length, 0);
    await db.exec('reset role');
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    console.log('PASS: Coach history RLS, anonymous denial, immutable ownership/context, independent saved answers, idempotent insert, downgrade read/delete, retained trades');
    await migration('0034_coach_conversations');
    await migration('0034_coach_conversations');
    await setUser(A);
    const createConversation = 'insert into coach_conversations(id,title) values ($1,$2) on conflict (user_id,id) do nothing';
    await query(createConversation, [token, 'Plan my session']);
    await query(createConversation, [token, 'Must not overwrite']);
    assert.equal((await query('select title from coach_conversations'))[0].title, 'Plan my session');
    const insertTurn = `insert into coach_chat_turns(user_id,id,conversation_id,prompt,answer,context) values ($1,$2,$3,'Review my day',$4::jsonb,'{}'::jsonb)`;
    await assert.rejects(query(insertTurn, [A, other, token, followUp]), /permission denied/);
    await assert.rejects(query('update coach_conversations set title=title'), /permission denied/);
    await db.exec('reset role; set role service_role');
    await assert.rejects(query(insertTurn, [B, other, token, followUp]), /foreign key constraint/);
    await query(insertTurn, [A, other, token, followUp]);
    await assert.rejects(query(insertTurn, [A, other, token, followUp]), /unique constraint/);
    await setUser(B);
    assert.equal((await query('select * from coach_conversations')).length, 0);
    assert.equal((await query('select * from coach_chat_turns')).length, 0);
    assert.equal((await query('delete from coach_conversations where user_id=$1 returning id', [A])).length, 0);
    await assert.rejects(query('insert into coach_conversations(user_id,id,title) values ($1,$2,$3)', [A, other, 'Forged']), /row-level security/);
    await db.exec('reset role; set role anon');
    for (const table of ['coach_conversations', 'coach_chat_turns']) await assert.rejects(query(`select * from ${table}`), /permission denied/);
    await setUser(A); // Still downgraded: saved data is not paywalled.
    assert.equal((await query('select * from coach_chat_turns')).length, 1);
    await assert.rejects(query('update coach_chat_turns set answer=answer'), /permission denied/);
    await assert.rejects(query('delete from coach_chat_turns'), /permission denied/);
    await query('delete from coach_conversations where id=$1', [token]);
    assert.equal((await query('select * from coach_chat_turns')).length, 0);
    await db.exec('reset role; set role service_role');
    await assert.rejects(query(insertTurn, [A, other, token, followUp]), /foreign key constraint/); // Late AI cannot recreate deleted history.
    await db.exec('reset role');
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    console.log('PASS: typed Coach owner isolation, service-only answers, replay uniqueness, immutable history, safe rerun, downgrade read/delete, conversation-only cascade, retained trades');

    const settingsBeforeSetup = await query('select * from user_settings order by user_id');
    await migration('0035_onboarding_progress');
    await migration('0035_onboarding_progress');
    assert.deepEqual(await query('select * from user_settings order by user_id'), settingsBeforeSetup);
    await setUser(A);
    const updateSetup = (patch: unknown) => query('select set_my_onboarding_progress($1::jsonb) as progress', [JSON.stringify(patch)]);
    await updateSetup({ started: true, accountsReviewed: true });
    const savedSetup = await updateSetup({ dismissed: true });
    assert.deepEqual(savedSetup[0].progress, { started: true, accountsReviewed: true, dismissed: true });
    for (const invalid of [null, [], 'yes', { user_id: B }, { dismissed: 'true' }, { accountsReviewed: null }, { alertsReviewed: {} }]) {
        await assert.rejects(updateSetup(invalid), /Setup progress must be an object|Invalid setup progress/);
    }
    const ownerPrefs = (await query('select prefs from user_settings'))[0].prefs;
    const withoutSetup = { ...ownerPrefs }; delete withoutSetup.onboarding;
    const oldPrefs = settingsBeforeSetup.find(row => row.user_id === A).prefs;
    assert.deepEqual(withoutSetup, oldPrefs);
    await setUser(B);
    const bSetup = await updateSetup({ alertsReviewed: true });
    assert.deepEqual(bSetup[0].progress, { alertsReviewed: true });
    assert.equal((await query('select prefs from user_settings where user_id=$1', [A])).length, 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(updateSetup({ dismissed: true }), /permission denied/);
    await setUser('');
    await assert.rejects(updateSetup({ dismissed: true }), /Authentication required/);
    await db.exec('reset role');
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, ownerPrefs);
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    console.log('PASS: setup progress owner isolation, anonymous denial, input validation, partial merging, safe rerun, unchanged alert preferences and trades');

    await migration('0036_broker_sync_checkpoints');
    await migration('0036_broker_sync_checkpoints');
    await setUser(A);
    const receipt = (connection: string, account: number, from: string | null = null, to = '2026-09-30T12:00:00Z') =>
        query('select record_my_broker_sync($1,$2,$3,$4) as receipt', [connection, account, from, to]);
    const firstReceipt = (await receipt('connection-a', 123))[0].receipt;
    assert.equal(firstReceipt.account_id, 123);
    assert.equal(firstReceipt.range_from, null);
    assert.equal(firstReceipt.user_id, undefined);
    await receipt('connection-a', 123, '2026-09-01T00:00:00Z');
    assert.equal((await query('select * from broker_sync_checkpoints')).length, 1);
    assert.equal(new Date((await query('select range_from from broker_sync_checkpoints'))[0].range_from).toISOString(), '2026-09-01T00:00:00.000Z');
    await assert.rejects(receipt('connection-a', -1), /check constraint/);
    await assert.rejects(receipt('', 123), /check constraint/);
    await assert.rejects(receipt('connection-a', 123, '2026-10-01'), /check constraint/);
    await assert.rejects(query('delete from broker_sync_checkpoints'), /permission denied/);
    await setUser(B);
    assert.equal((await query('select * from broker_sync_checkpoints')).length, 0);
    await receipt('connection-a', 123);
    await assert.rejects(query("insert into broker_sync_checkpoints(user_id,connection_id,account_id,range_to) values ($1,'forged',1,now())", [A]), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(receipt('connection-a', 123), /permission denied/);
    await assert.rejects(query('select * from broker_sync_checkpoints'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await query('select * from broker_sync_checkpoints')).length, 2);
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, ownerPrefs);
    console.log('PASS: broker sync receipts owner isolation, anonymous denial, safe rerun, range validation, per-account upsert and retained trades/preferences');

    await migration('0037_ai_coaching_preferences');
    await migration('0037_ai_coaching_preferences');
    const mode = (enabled: boolean | null, accept = false) => query('select set_my_ai_coaching_mode($1,$2) as preference', [enabled, accept]);
    await setUser(A);
    assert.equal((await query('select * from ai_coaching_preferences')).length, 0);
    await assert.rejects(mode(null), /mode is required/);
    await assert.rejects(mode(true), /Accept.*disclaimer/);
    await assert.rejects(mode(true, true), /AI access required/);
    await assert.rejects(query('insert into ai_coaching_preferences(user_id,unhinged) values ($1,true)', [A]), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(query('insert into ai_coaching_preferences(user_id,unhinged,consented_at) values ($1,true,now())', [A]), /check constraint/);
    await query('update profiles set ai_access_override=true where id=$1', [A]);
    await setUser(A);
    const enabledMode = (await mode(true, true))[0].preference;
    assert.equal(enabledMode.unhinged, true); assert.equal(enabledMode.consent_version, 1);
    assert.ok(Number.isFinite(Date.parse(enabledMode.consented_at))); assert.equal(enabledMode.user_id, undefined);
    await assert.rejects(query('update ai_coaching_preferences set unhinged=false'), /permission denied/);
    await assert.rejects(query('delete from ai_coaching_preferences'), /permission denied/);
    await setUser(B);
    assert.equal((await query('select * from ai_coaching_preferences')).length, 0);
    await mode(false);
    assert.equal((await query('select user_id from ai_coaching_preferences'))[0].user_id, B);
    await db.exec('reset role; set role service_role');
    assert.equal((await query('select * from ai_coaching_preferences where user_id=$1', [A])).length, 1);
    await db.exec('reset role; set role anon');
    await assert.rejects(mode(false), /permission denied/);
    await assert.rejects(query('select * from ai_coaching_preferences'), /permission denied/);
    await setUser('');
    await assert.rejects(mode(false), /Authentication required/);
    await db.exec('reset role');
    await query('update profiles set ai_access_override=false where id=$1', [A]);
    await setUser(A);
    const disabledMode = (await mode(false))[0].preference;
    assert.equal(disabledMode.unhinged, false); assert.equal(disabledMode.consented_at, enabledMode.consented_at);
    await assert.rejects(mode(true), /Accept.*disclaimer/);
    await assert.rejects(mode(true, true), /AI access required/);
    await db.exec('reset role');
    assert.deepEqual(await query('select * from trades order by id'), tradesBeforePlus);
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, ownerPrefs);
    console.log('PASS: AI tone explicit consent, current entitlement, service-only verification, owner isolation, anonymous denial, safe rerun, downgrade opt-out and retained data');
} finally { await db.close(); }
