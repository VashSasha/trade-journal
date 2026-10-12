import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PAGE_SIZE = 100;
const MAX_ENTRIES = 10_000;

function missingBucket(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { statusCode?: unknown; message?: unknown };
    return String(value.statusCode) === '404'
        && String(value.message ?? '').toLowerCase().includes('bucket');
}

/** Call only after verifying the user, recent authentication, and stopping billing. */
export async function deleteUserWithSounds(
    client: Pick<SupabaseClient, 'storage' | 'auth'>,
    userId: string,
    renew: () => Promise<void>,
): Promise<void> {
    // A destructive operation must never accept a root/partial prefix or traversal path.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        throw new Error('Invalid sound cleanup owner.');
    }
    const bucket = client.storage.from('custom-alert-sounds');
    const collect = async (): Promise<string[]> => {
        const folders = [userId];
        const seen = new Set<string>();
        const files: string[] = [];
        for (const folder of folders) {
            for (let offset = 0; ; offset += PAGE_SIZE) {
                await renew();
                const { data, error } = await bucket.list(folder, {
                    limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' },
                });
                if (missingBucket(error)) return [];
                if (error) throw error;
                if (!Array.isArray(data)) throw new Error('Sound listing unavailable.');
                for (const entry of data) {
                    // Storage returns immediate children, not absolute object paths.
                    if (!entry.name || entry.name === '.' || entry.name === '..' || /[\\/\x00]/.test(entry.name)) {
                        throw new Error('Unexpected sound storage path.');
                    }
                    const path = `${folder}/${entry.name}`;
                    if (seen.has(path) || seen.size >= MAX_ENTRIES) throw new Error('Sound listing exceeded safe limits.');
                    seen.add(path);
                    if (entry.id) files.push(path);
                    else folders.push(path); // Include any older nested uploads, too.
                }
                if (data.length < PAGE_SIZE) break;
            }
        }
        return files;
    };

    // Collect all pages BEFORE removal: deleting while incrementing offsets skips files.
    const paths = await collect();
    for (let start = 0; start < paths.length; start += PAGE_SIZE) {
        await renew();
        const { error } = await bucket.remove(paths.slice(start, start + PAGE_SIZE));
        if (error) throw error;
    }
    // Fail closed on partial cleanup or a concurrent upload; retry is safe/idempotent.
    if ((await collect()).length) throw new Error('Sound cleanup incomplete. Please retry.');
    await renew();
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw error;
}
