import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import { AlertSoundKind } from './session-alerts.utils';
import {
    ALERT_SOUND_KINDS, CustomAlertSoundMap, emptyCustomAlertSoundMap, metadataMap,
    parseCustomAlertSoundMetadata, parseStoredCustomAlertSound, StoredCustomAlertSound,
} from './custom-alert-sounds.models';

const DATABASE_NAME = 'nvzn-alert-audio';
const STORE_NAME = 'custom-sounds';
const OWNER_INDEX = 'owner';
const CHANNEL_NAME = 'nvzn-custom-alert-audio';
const BUCKET_NAME = 'custom-alert-sounds';
const TABLE_NAME = 'custom_alert_sounds';

type NewCustomSound = Omit<StoredCustomAlertSound, 'id' | 'owner' | 'cloudSynced'>;

interface CloudLoad {
    records: StoredCustomAlertSound[];
    knownKinds: Set<AlertSoundKind>;
    incomplete: boolean;
}

/** Private account-synced audio with IndexedDB as a fast/offline cache. */
@Injectable({ providedIn: 'root' })
export class CustomAlertSoundsService {
    private readonly document = inject(DOCUMENT);
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    private readonly localSupported = !!this.view?.indexedDB;
    readonly supported = !!this.view;
    readonly sounds = signal<CustomAlertSoundMap>(emptyCustomAlertSoundMap());
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly revision = signal(0);
    private database: Promise<IDBDatabase> | null = null;
    private records = new Map<AlertSoundKind, StoredCustomAlertSound>();
    private loadGeneration = 0;
    private localLoadRequest: Promise<void> = Promise.resolve();
    private readonly channel = this.view && 'BroadcastChannel' in this.view
        ? new this.view.BroadcastChannel(CHANNEL_NAME)
        : null;

    constructor() {
        effect(() => this.startOwnerLoad(this.session.userId()));
        if (this.channel) {
            this.channel.onmessage = event => {
                const owner = event.data && typeof event.data === 'object'
                    ? (event.data as { owner?: unknown }).owner
                    : null;
                if (owner === this.session.userId()) this.startOwnerLoad(this.session.userId());
            };
        }
        const online = () => {
            const owner = this.session.userId();
            if (owner) void this.syncCloudOwner(owner, ++this.loadGeneration);
        };
        this.view?.addEventListener('online', online);
        this.destroyRef.onDestroy(() => {
            this.channel?.close();
            this.view?.removeEventListener('online', online);
            void this.database?.then(database => database.close()).catch(() => undefined);
        });
    }

    async currentRecords(): Promise<StoredCustomAlertSound[]> {
        await this.localLoadRequest;
        return [...this.records.values()].map(record => ({ ...record, bytes: record.bytes.slice(0) }));
    }

    async save(sound: NewCustomSound): Promise<void> {
        const operation = this.session.capture();
        if (!this.supported) throw new Error('Custom sound storage is unavailable in this browser.');
        const candidate = parseStoredCustomAlertSound({
            ...sound,
            id: `${operation.userId}:${sound.kind}`,
            owner: operation.userId,
            cloudSynced: false,
        }, operation.userId);
        if (!candidate) throw new Error('The custom sound is invalid.');

        let record: StoredCustomAlertSound;
        try {
            record = await this.saveCloud(candidate, operation);
        } catch (error) {
            throw new Error(this.cloudError(error, 'save'));
        }
        this.session.assertCurrent(operation);
        this.records.set(sound.kind, record);
        let cacheFailed = false;
        await this.cacheRecord(record).catch(() => {
            cacheFailed = true;
        });
        this.publishState();
        if (cacheFailed) {
            this.error.set('Sound is synced to your account, but this browser could not cache it for offline playback.');
        }
        this.channel?.postMessage({ owner: operation.userId });
    }

    async remove(kind: AlertSoundKind): Promise<void> {
        const operation = this.session.capture();
        if (!this.supported) throw new Error('Custom sound storage is unavailable in this browser.');
        const previous = this.records.get(kind);
        try {
            const bucket = this.client.storage.from(BUCKET_NAME);
            const { error: fileError } = await bucket.remove([this.objectPath(operation.userId, kind)]);
            if (fileError) throw fileError;
            this.session.assertCurrent(operation);
            const { error: rowError } = await this.client.from(TABLE_NAME)
                .delete()
                .eq('user_id', operation.userId)
                .eq('kind', kind)
                .abortSignal(operation.signal);
            if (rowError) {
                // Restore the file when metadata deletion fails, keeping the
                // previously valid cloud setting internally consistent.
                if (previous) await this.uploadObject(previous, operation).catch(() => undefined);
                throw rowError;
            }
        } catch (error) {
            throw new Error(this.cloudError(error, 'remove'));
        }
        this.session.assertCurrent(operation);
        this.records.delete(kind);
        await this.removeCachedRecord(operation.userId, kind).catch(() => undefined);
        this.publishState();
        this.channel?.postMessage({ owner: operation.userId });
    }

    private startOwnerLoad(owner: string | null): void {
        const generation = ++this.loadGeneration;
        this.records.clear();
        this.sounds.set(emptyCustomAlertSoundMap());
        this.revision.update(value => value + 1);
        this.error.set(null);
        this.loading.set(!!owner);
        if (!owner) {
            this.localLoadRequest = Promise.resolve();
            return;
        }
        this.localLoadRequest = this.loadLocalOwner(owner, generation);
        void this.localLoadRequest.then(() => this.syncCloudOwner(owner, generation));
    }

    private async loadLocalOwner(owner: string, generation: number): Promise<void> {
        if (!this.localSupported) return;
        try {
            const records = await this.readLocalOwner(owner);
            if (!this.isCurrentLoad(owner, generation)) return;
            this.records = new Map(records.map(record => [record.kind, record]));
            this.publishState();
        } catch {
            // Cloud remains authoritative; a broken cache must not block it.
        }
    }

    private async syncCloudOwner(owner: string, generation: number): Promise<void> {
        if (!this.isCurrentLoad(owner, generation)) return;
        const operation = this.session.capture();
        const local = new Map(this.records);
        try {
            const cloud = await this.readCloudOwner(owner, operation, local);
            this.session.assertCurrent(operation);
            if (!this.isCurrentLoad(owner, generation)) return;
            const merged = new Map(cloud.records.map(record => [record.kind, record]));
            let migrationFailed = false;

            // One-time migration for files created by the browser-local version.
            for (const record of local.values()) {
                if (cloud.knownKinds.has(record.kind)) {
                    if (!merged.has(record.kind)) merged.set(record.kind, record);
                    continue;
                }
                if (record.cloudSynced) continue; // Deleted from another browser.
                try {
                    merged.set(record.kind, await this.saveCloud(record, operation));
                } catch {
                    merged.set(record.kind, record);
                    migrationFailed = true;
                }
            }

            this.session.assertCurrent(operation);
            if (!this.isCurrentLoad(owner, generation)) return;
            this.records = merged;
            this.publishState();
            await this.replaceLocalCache(owner, merged).catch(() => undefined);
            if (cloud.incomplete || migrationFailed) {
                this.error.set('Some custom sounds could not be refreshed. Saved browser copies remain available.');
            }
        } catch (error) {
            if (!this.session.isCurrent(operation) || !this.isCurrentLoad(owner, generation)) return;
            this.error.set(this.cloudError(error, 'load', this.records.size > 0));
        } finally {
            if (this.isCurrentLoad(owner, generation)) this.loading.set(false);
        }
    }

    private async readCloudOwner(
        owner: string,
        operation: UserOperation,
        local: ReadonlyMap<AlertSoundKind, StoredCustomAlertSound>,
    ): Promise<CloudLoad> {
        const { data, error } = await this.client.from(TABLE_NAME)
            .select('kind,file_name,mime_type,size_bytes,duration_seconds,updated_at')
            .eq('user_id', owner)
            .abortSignal(operation.signal);
        if (error) throw error;
        this.session.assertCurrent(operation);
        const metadata = (data ?? []).map(row => this.parseCloudRow(row)).filter(value => value !== null);
        const knownKinds = new Set(metadata.map(value => value.kind));
        let incomplete = metadata.length !== (data?.length ?? 0);
        const settled = await Promise.allSettled(metadata.map(async value => {
            const cached = local.get(value.kind);
            if (cached?.cloudSynced && cached.updatedAt === value.updatedAt) return cached;
            const { data: blob, error: fileError } = await this.client.storage.from(BUCKET_NAME)
                .download(this.objectPath(owner, value.kind), { cacheNonce: value.updatedAt }, { signal: operation.signal });
            if (fileError || !blob) throw fileError ?? new Error('Custom sound file is missing.');
            const record = parseStoredCustomAlertSound({
                ...value,
                id: `${owner}:${value.kind}`,
                owner,
                bytes: await blob.arrayBuffer(),
                cloudSynced: true,
            }, owner);
            if (!record) throw new Error('Custom sound file failed validation.');
            return record;
        }));
        const records: StoredCustomAlertSound[] = [];
        for (const result of settled) {
            if (result.status === 'fulfilled') records.push(result.value);
            else incomplete = true;
        }
        return { records, knownKinds, incomplete };
    }

    private parseCloudRow(value: unknown) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const row = value as Record<string, unknown>;
        return parseCustomAlertSoundMetadata({
            kind: row['kind'],
            name: row['file_name'],
            mimeType: row['mime_type'],
            size: Number(row['size_bytes']),
            duration: Number(row['duration_seconds']),
            updatedAt: row['updated_at'],
        });
    }

    private async saveCloud(sound: NewCustomSound, operation: UserOperation): Promise<StoredCustomAlertSound> {
        const previous = this.records.get(sound.kind);
        await this.uploadObject(sound, operation);
        let updatedAt: unknown;
        try {
            this.session.assertCurrent(operation);
            const { data, error } = await this.client.from(TABLE_NAME).upsert({
                user_id: operation.userId,
                kind: sound.kind,
                file_name: sound.name,
                mime_type: sound.mimeType,
                size_bytes: sound.bytes.byteLength,
                duration_seconds: sound.duration,
            }, { onConflict: 'user_id,kind' }).select('updated_at').abortSignal(operation.signal).single();
            if (error || !data) throw error ?? new Error('Custom sound metadata was not saved.');
            this.session.assertCurrent(operation);
            updatedAt = data.updated_at;
        } catch (error) {
            if (previous?.cloudSynced) await this.uploadObject(previous, operation).catch(() => undefined);
            else await this.client.storage.from(BUCKET_NAME)
                .remove([this.objectPath(operation.userId, sound.kind)]).catch(() => undefined);
            throw error;
        }
        const record = parseStoredCustomAlertSound({
            ...sound,
            id: `${operation.userId}:${sound.kind}`,
            owner: operation.userId,
            size: sound.bytes.byteLength,
            updatedAt,
            bytes: sound.bytes.slice(0),
            cloudSynced: true,
        }, operation.userId);
        if (!record) throw new Error('Saved custom sound metadata was invalid.');
        return record;
    }

    private async uploadObject(sound: NewCustomSound, operation: UserOperation): Promise<void> {
        const { error } = await this.client.storage.from(BUCKET_NAME).upload(
            this.objectPath(operation.userId, sound.kind),
            sound.bytes.slice(0),
            { cacheControl: '3600', contentType: sound.mimeType, upsert: true },
        );
        if (error) throw error;
    }

    private objectPath(owner: string, kind: AlertSoundKind): string {
        return `${owner}/${kind}`;
    }

    private isCurrentLoad(owner: string, generation: number): boolean {
        return generation === this.loadGeneration && owner === this.session.userId();
    }

    private publishState(clearError = true): void {
        this.sounds.set(metadataMap([...this.records.values()]));
        if (clearError) this.error.set(null);
        this.revision.update(value => value + 1);
    }

    private async readLocalOwner(owner: string): Promise<StoredCustomAlertSound[]> {
        const values = await this.write<unknown[]>('readonly', store => store.index(OWNER_INDEX).getAll(owner));
        return values.map(value => parseStoredCustomAlertSound(value, owner))
            .filter((value): value is StoredCustomAlertSound => value !== null);
    }

    private async cacheRecord(record: StoredCustomAlertSound): Promise<void> {
        if (!this.localSupported) return;
        await this.write('readwrite', store => store.put({ ...record, bytes: record.bytes.slice(0) }));
    }

    private async removeCachedRecord(owner: string, kind: AlertSoundKind): Promise<void> {
        if (!this.localSupported) return;
        await this.write('readwrite', store => store.delete(`${owner}:${kind}`));
    }

    private async replaceLocalCache(
        owner: string,
        records: ReadonlyMap<AlertSoundKind, StoredCustomAlertSound>,
    ): Promise<void> {
        if (!this.localSupported) return;
        await Promise.all(ALERT_SOUND_KINDS.map(kind => {
            const record = records.get(kind);
            return record ? this.cacheRecord(record) : this.removeCachedRecord(owner, kind);
        }));
    }

    private cloudError(error: unknown, action: 'load' | 'save' | 'remove', hasLocal = false): string {
        if (this.isMissingCloudSetup(error)) {
            return 'Account sound sync is not configured yet. Apply migration 0022_custom_alert_sounds.sql.';
        }
        if (action === 'load') return hasLocal
            ? 'Account sound sync is temporarily unavailable. Saved browser copies remain available.'
            : 'Custom sounds could not be loaded. Built-in sounds remain available.';
        return action === 'save'
            ? 'The sound could not be synced to your account. Please try again.'
            : 'The custom sound could not be reset. Please try again.';
    }

    private isMissingCloudSetup(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const value = error as { code?: unknown; statusCode?: unknown; message?: unknown };
        const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
        return value.code === '42P01' || value.code === 'PGRST205'
            || (String(value.statusCode) === '404' && message.includes('bucket'));
    }

    private async write<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        const database = await this.openDatabase();
        return new Promise<T>((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, mode);
            const operation = request(transaction.objectStore(STORE_NAME));
            let result!: T;
            operation.onsuccess = () => { result = operation.result; };
            operation.onerror = () => reject(operation.error ?? new Error('Browser storage request failed.'));
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
            transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was cancelled.'));
        });
    }

    private openDatabase(): Promise<IDBDatabase> {
        if (this.database) return this.database;
        const indexedDb = this.view?.indexedDB;
        if (!indexedDb) return Promise.reject(new Error('IndexedDB is unavailable.'));
        this.database = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDb.open(DATABASE_NAME, 1);
            request.onupgradeneeded = () => {
                const database = request.result;
                const store = database.objectStoreNames.contains(STORE_NAME)
                    ? request.transaction!.objectStore(STORE_NAME)
                    : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                if (!store.indexNames.contains(OWNER_INDEX)) store.createIndex(OWNER_INDEX, OWNER_INDEX, { unique: false });
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error ?? new Error('Could not open browser audio storage.'));
            request.onblocked = () => reject(new Error('Close other NVZN tabs before updating browser audio storage.'));
        }).catch(error => {
            this.database = null;
            throw error;
        });
        return this.database;
    }
}
