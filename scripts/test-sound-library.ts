// Disposable in-memory Postgres; no live project, credentials, or network.
// deno run --cached-only --no-lock --node-modules-dir=none --allow-read --allow-env scripts/test-sound-library.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url));
const migration = async (name: string) => db.exec(await read(`supabase/migrations/${name}.sql`));
const query = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
        create schema storage;
        create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects(name text primary key, owner_id text, bucket_id text);
        alter table storage.objects enable row level security;
        create function storage.foldername(path text) returns text[] language sql immutable as
            $$select (string_to_array(path,'/'))[1:cardinality(string_to_array(path,'/'))-1]$$;
        create function storage.filename(path text) returns text language sql immutable as
            $$select (string_to_array(path,'/'))[cardinality(string_to_array(path,'/'))]$$;
        grant usage on schema auth, public, storage to authenticated, anon, service_role;
        grant select,insert,update,delete on storage.objects to authenticated;
    `);
    await migration('0002_user_data');
    await migration('0022_custom_alert_sounds');
    await migration('0023_session_sound_preferences');
    await db.exec('grant select,insert,update on public.user_settings to authenticated;');
    await query('insert into auth.users values ($1), ($2)', [A, B]);
    await query('insert into user_settings(user_id, prefs) values ($1, $2::jsonb)', [A, JSON.stringify({ theme: 'dark', session_sounds: { volume: 55, armed: true, opens: true, closes: false } })]);
    const before = (await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs;
    await migration('0038_alert_sound_library');
    await migration('0038_alert_sound_library');
    assert.deepEqual((await query('select prefs from user_settings where user_id=$1', [A]))[0].prefs, before);
    const user = async (id: string) => {
        await db.exec('reset role');
        await query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
        await db.exec('set role authenticated');
    };
    const save = (prefs: unknown) => query('select set_my_session_sound_preferences($1::jsonb) as saved', [JSON.stringify(prefs)]);
    const base = { volume: 45, armed: true, opens: true, closes: true };
    await user(A);
    const catalog = await read('src/app/features/alerts/alert-sound-library.ts');
    const ids = [...catalog.matchAll(/id: '([a-z-]+)'/g)].map(match => match[1]);
    assert.equal(ids.length, 10);
    const kindsFile = await read('src/app/features/alerts/alert-sound-kinds.ts');
    const kinds = [...kindsFile.split('] as const;')[0].matchAll(/'([a-zA-Z]+)'/g)].map(match => match[1]);
    assert.equal(kinds.length, 16);
    for (const id of [...ids, 'default', 'custom', 'silent', 'inherit']) {
        const selections = Object.fromEntries(kinds.map(kind => [kind, id]));
        assert.deepEqual((await save({ ...base, selections }))[0].saved.selections, selections);
    }
    await save({ ...base, selections: { dailyLoss: 'oh-no', open: 'stock-market-bell' } });
    await save({ ...base, volume: 20 }); // Old browser must not erase choices.
    const saved = (await query('select prefs from user_settings'))[0].prefs;
    assert.equal(saved.theme, 'dark');
    assert.deepEqual(saved.session_sounds.selections, { dailyLoss: 'oh-no', open: 'stock-market-bell' });
    for (const selections of [null, [], { open: 'https://bad/audio' }, { other: 'hell-yeah' }, { open: 5 }]) {
        await assert.rejects(save({ ...base, selections }));
    }
    for (const kind of kinds) {
        await query('insert into custom_alert_sounds(kind,file_name,mime_type,size_bytes,duration_seconds) values ($1,$2,$3,100,1)', [kind, 'mine.mp3', 'audio/mpeg']);
        await query('insert into storage.objects values ($1,$2,$3)', [`${A}/${kind}`, A, 'custom-alert-sounds']);
    }
    await assert.rejects(query('insert into storage.objects values ($1,$2,$3)', [`${B}/open`, A, 'custom-alert-sounds']));
    await assert.rejects(query('insert into storage.objects values ($1,$2,$3)', [`${A}/nested/open`, A, 'custom-alert-sounds']));
    await assert.rejects(query('insert into storage.objects values ($1,$2,$3)', [`${A}/unknown`, A, 'custom-alert-sounds']));
    await user(B);
    assert.equal((await query('select * from custom_alert_sounds')).length, 0);
    assert.equal((await query('select * from storage.objects')).length, 0);
    assert.equal((await query('select * from user_settings')).length, 0);
    await save({ ...base, selections: { positionOpened: 'hell-yeah' } });
    await user(A);
    assert.equal((await query('select prefs from user_settings'))[0].prefs.session_sounds.selections.open, 'stock-market-bell');
    await db.exec('reset role; set role anon;');
    await assert.rejects(save(base), /permission denied/);
    await db.exec('reset role;');
    await query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role authenticated;');
    await assert.rejects(save(base), /Authentication required/);
    for (const id of ids) {
        const asset = await Deno.readFile(new URL(`../public/sounds/library-v1/${id}.mp3`, import.meta.url));
        assert.ok(asset.byteLength > 0 && asset.byteLength <= 3 * 1024 * 1024);
    }
    console.log('PASS: sound catalog, assets, all trigger IDs, migration rerun, old clients, private uploads and owner isolation');
} finally { await db.close(); }
