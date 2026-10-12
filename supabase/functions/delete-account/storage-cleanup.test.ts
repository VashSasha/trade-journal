import assert from 'node:assert/strict';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { deleteUserWithSounds } from './storage-cleanup.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SOUND_KINDS = [
    'open', 'close', 'target', 'risk', 'dailyProfit', 'weeklyProfit',
    'dailyLoss', 'weeklyLoss', 'dailyTrades', 'dailyProfitOpen', 'marketEvent',
    'positionOpened', 'positionIncreased', 'positionReduced', 'positionClosed', 'positionReversed',
];

function fixture(names: string[]) {
    const files = new Set([...names.map(name => `${OWNER}/${name}`), `${OTHER}/dailyProfit`]);
    const events: string[] = [];
    const removals: string[][] = [];
    const deletions: string[] = [];
    const state = { failRemove: 0, listError: null as unknown, malformedName: '',
        noProgress: false, concurrentUpload: false, failAuth: false };
    const bucket = {
        list(folder: string, options: { offset: number; limit: number }) {
            assert(folder === OWNER || folder.startsWith(`${OWNER}/`));
            events.push(`list:${folder}:${options.offset}`);
            if (state.listError) return Promise.resolve({ data: null, error: state.listError });
            if (state.malformedName) return Promise.resolve({
                data: [{ name: state.malformedName, id: 'file' }], error: null,
            });
            const entries = new Map<string, { name: string; id: string | null }>();
            for (const path of files) {
                if (!path.startsWith(`${folder}/`)) continue;
                const rest = path.slice(folder.length + 1);
                const name = rest.split('/')[0];
                entries.set(name, { name, id: rest.includes('/') ? null : path });
            }
            const data = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
                .slice(options.offset, options.offset + options.limit);
            return Promise.resolve({ data, error: null });
        },
        remove(paths: string[]) {
            removals.push(paths); events.push('remove');
            assert(paths.length <= 100);
            assert(paths.every(path => path.startsWith(`${OWNER}/`)));
            if (state.failRemove === removals.length) return Promise.resolve({ error: new Error('Storage unavailable') });
            if (!state.noProgress) paths.forEach(path => files.delete(path));
            if (state.concurrentUpload) files.add(`${OWNER}/new-upload`);
            return Promise.resolve({ error: null });
        },
    };
    const client = {
        storage: { from(name: string) { assert.equal(name, 'custom-alert-sounds'); return bucket; } },
        auth: { admin: { deleteUser(id: string) {
            events.push('deleteUser'); deletions.push(id);
            return Promise.resolve({ error: state.failAuth ? new Error('Auth unavailable') : null });
        } } },
    } as unknown as SupabaseClient;
    const renew = async () => { events.push('renew'); };
    return { client, state, files, removals, deletions, events, renew };
}

Deno.test('deletion removes all 16 sound kinds plus orphan files before deleting only the verified user', async () => {
    const f = fixture([...SOUND_KINDS, 'orphan-no-metadata', 'older/upload.mp3']);
    await deleteUserWithSounds(f.client, OWNER, f.renew);
    assert.deepEqual([...f.files], [`${OTHER}/dailyProfit`]);
    assert.deepEqual(f.deletions, [OWNER]);
    assert.equal(f.events.at(-1), 'deleteUser');
    assert.equal(f.removals.flat().length, 18);
});

Deno.test('deletion collects every page before bounded removal without skipping shifted offsets', async () => {
    const f = fixture(Array.from({ length: 245 }, (_, i) => `sound-${i.toString().padStart(3, '0')}`));
    await deleteUserWithSounds(f.client, OWNER, f.renew);
    assert.deepEqual(f.removals.map(batch => batch.length), [100, 100, 45]);
    assert.deepEqual([...f.files], [`${OTHER}/dailyProfit`]);
    assert(f.events.indexOf(`list:${OWNER}:200`) < f.events.indexOf('remove'));
});

Deno.test('partial removal retains Auth and retry safely completes remaining objects', async () => {
    const f = fixture(Array.from({ length: 150 }, (_, i) => `sound-${i}`));
    f.state.failRemove = 2;
    await assert.rejects(deleteUserWithSounds(f.client, OWNER, f.renew), /Storage unavailable/);
    assert.deepEqual(f.deletions, []);
    assert.equal(f.files.size, 51);
    f.state.failRemove = 0;
    await deleteUserWithSounds(f.client, OWNER, f.renew);
    assert.deepEqual(f.deletions, [OWNER]);
    assert.deepEqual([...f.files], [`${OTHER}/dailyProfit`]);
});

Deno.test('only a specifically missing bucket is treated as already clean', async () => {
    const f = fixture([]);
    f.state.listError = { statusCode: '404', message: 'Bucket not found' };
    await deleteUserWithSounds(f.client, OWNER, f.renew);
    assert.deepEqual(f.deletions, [OWNER]);
    assert.deepEqual(f.removals, []);
    for (const error of [new Error('offline'), { statusCode: 404, message: 'Object not found' },
        { statusCode: 403, message: 'Bucket forbidden' }]) {
        const failed = fixture([]); failed.state.listError = error;
        await assert.rejects(deleteUserWithSounds(failed.client, OWNER, failed.renew));
        assert.deepEqual(failed.deletions, []);
    }
});

Deno.test('unconfirmed removal and concurrent uploads retain Auth for safe retry', async () => {
    for (const condition of ['noProgress', 'concurrentUpload'] as const) {
        const f = fixture(['dailyProfit']); f.state[condition] = true;
        await assert.rejects(deleteUserWithSounds(f.client, OWNER, f.renew), /cleanup incomplete/);
        assert.deepEqual(f.deletions, []);
        assert(f.files.has(`${OTHER}/dailyProfit`));
    }
});

Deno.test('rejects root, partial owner, and traversal targets before any destructive call', async () => {
    for (const owner of ['', '/', '..', OWNER.slice(0, 8), `${OWNER}/..`]) {
        const f = fixture(['open']);
        await assert.rejects(deleteUserWithSounds(f.client, owner, f.renew), /Invalid sound cleanup owner/);
        assert.deepEqual(f.events, []);
    }
    for (const name of ['..', '.', '../other/open', '/open', 'other\\open']) {
        const f = fixture([]); f.state.malformedName = name;
        await assert.rejects(deleteUserWithSounds(f.client, OWNER, f.renew), /Unexpected sound storage path/);
        assert.deepEqual(f.removals, []);
        assert.deepEqual(f.deletions, []);
    }
});

Deno.test('losing the billing lock prevents further deletion', async () => {
    const f = fixture(['open']);
    await assert.rejects(deleteUserWithSounds(f.client, OWNER, async () => {
        throw new Error('Lock lost');
    }), /Lock lost/);
    assert.deepEqual(f.removals, []);
    assert.deepEqual(f.deletions, []);
});

Deno.test('Auth deletion failure is surfaced and cleanup can be retried with an empty folder', async () => {
    const f = fixture(['positionOpened']); f.state.failAuth = true;
    await assert.rejects(deleteUserWithSounds(f.client, OWNER, f.renew), /Auth unavailable/);
    assert.deepEqual([...f.files], [`${OTHER}/dailyProfit`]);
    f.state.failAuth = false;
    await deleteUserWithSounds(f.client, OWNER, f.renew);
    assert.equal(f.removals.length, 1);
    assert.equal(f.deletions.length, 2);
});
