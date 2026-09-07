import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { CustomAlertSoundsService } from './custom-alert-sounds.service';

interface CloudRow {
    kind: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    duration_seconds: number;
    updated_at: string;
}

describe('account-synced custom alert sounds', () => {
    function setup(initialRows: CloudRow[] = [], initialFiles: Record<string, ArrayBuffer> = {}) {
        const owner = '11111111-1111-4111-8111-111111111111';
        const userId = signal<string | null>(owner);
        const controller = new AbortController();
        const rows = [...initialRows];
        const files = new Map(Object.entries(initialFiles));
        let upserted: Record<string, unknown> | null = null;
        const from = vi.fn(() => {
            let action: 'select' | 'upsert' | 'delete' = 'select';
            let deleteKind = '';
            const query: any = {
                select: () => query,
                eq: (key: string, value: string) => {
                    if (action === 'delete' && key === 'kind') deleteKind = value;
                    return query;
                },
                abortSignal: () => query,
                delete: () => { action = 'delete'; return query; },
                upsert: (value: Record<string, unknown>) => { action = 'upsert'; upserted = value; return query; },
                single: async () => ({ data: { updated_at: '2026-09-06T12:00:00.000Z' }, error: null }),
                then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
                    const result = action === 'select'
                        ? { data: rows, error: null }
                        : { data: null, error: null };
                    if (action === 'delete') {
                        const index = rows.findIndex(row => row.kind === deleteKind);
                        if (index >= 0) rows.splice(index, 1);
                    }
                    return Promise.resolve(result).then(resolve, reject);
                },
            };
            return query;
        });
        const download = vi.fn(async (path: string) => {
            const bytes = files.get(path);
            return bytes
                ? { data: { arrayBuffer: async () => bytes.slice(0) } as Blob, error: null }
                : { data: null, error: { statusCode: '404', message: 'Object not found' } };
        });
        const upload = vi.fn(async (path: string, bytes: ArrayBuffer) => {
            files.set(path, bytes.slice(0));
            return { data: { path }, error: null };
        });
        const remove = vi.fn(async (paths: string[]) => {
            paths.forEach(path => files.delete(path));
            return { data: [], error: null };
        });
        const client = { from, storage: { from: () => ({ download, upload, remove }) } };
        const session = {
            userId,
            capture: () => ({ userId: owner, signal: controller.signal }),
            assertCurrent: (operation: { userId: string; signal: AbortSignal }) => {
                if (operation.signal.aborted || operation.userId !== userId()) throw new Error('session changed');
            },
            isCurrent: (operation: { userId: string; signal: AbortSignal }) =>
                !operation.signal.aborted && operation.userId === userId(),
        };
        TestBed.configureTestingModule({ providers: [
            { provide: SupabaseService, useValue: { client } },
            { provide: UserSessionService, useValue: session },
        ] });
        const service = TestBed.inject(CustomAlertSoundsService);
        TestBed.tick();
        return {
            owner, download, upload, remove,
            service,
            upserted: () => upserted,
        };
    }

    afterEach(() => TestBed.resetTestingModule());

    it('downloads private cloud audio for the same account in a fresh browser', async () => {
        const owner = '11111111-1111-4111-8111-111111111111';
        const updatedAt = '2026-09-06T10:00:00.000Z';
        const { service, download } = setup([{
            kind: 'open', file_name: 'bell.mp3', mime_type: 'audio/mpeg', size_bytes: 8,
            duration_seconds: 1.2, updated_at: updatedAt,
        }], { [`${owner}/open`]: new ArrayBuffer(8) });

        await vi.waitFor(() => expect(service.loading()).toBe(false));
        expect(service.error()).toBeNull();
        expect(service.sounds().open?.name).toBe('bell.mp3');
        expect((await service.currentRecords())[0].cloudSynced).toBe(true);
        expect(download).toHaveBeenCalledWith(`${owner}/open`, { cacheNonce: updatedAt }, expect.anything());
    });

    it('uploads to the owner path and saves only bounded metadata', async () => {
        const { owner, service, upload, upserted } = setup();
        await vi.waitFor(() => expect(service.loading()).toBe(false));
        await service.save({
            kind: 'target', name: 'goal.mp3', mimeType: 'audio/mpeg', size: 8,
            duration: 1.5, updatedAt: '2026-09-06T10:00:00.000Z', bytes: new ArrayBuffer(8),
        });

        expect(upload).toHaveBeenCalledWith(`${owner}/target`, expect.any(ArrayBuffer), expect.objectContaining({
            contentType: 'audio/mpeg', upsert: true,
        }));
        expect(upserted()).toEqual(expect.objectContaining({ user_id: owner, kind: 'target', size_bytes: 8 }));
        expect(service.sounds().target?.name).toBe('goal.mp3');
    });
});
