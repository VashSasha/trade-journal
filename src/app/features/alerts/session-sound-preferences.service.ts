import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import {
    DEFAULT_SESSION_SOUNDS,
    normalizeSoundPreferences,
    parseSoundPreferences,
    SessionSoundPreferences,
} from './session-alerts.utils';

const LEGACY_KEY = 'nvzn_session_sound_preferences_v1';
const CACHE_PREFIX = 'nvzn_session_sound_preferences_v2:';
const CLOUD_KEY = 'session_sounds';
const SAVE_DELAY_MS = 300;

interface CachedPreferences {
    version: 1;
    preferences: SessionSoundPreferences;
    pending: boolean;
    updatedAt: number;
}

/** Account-synced sound intent with a per-user browser cache for instant/offline use. */
@Injectable({ providedIn: 'root' })
export class SessionSoundPreferencesService {
    private readonly document = inject(DOCUMENT);
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    readonly owner = this.session.userId;
    readonly preferences = signal<SessionSoundPreferences>({ ...DEFAULT_SESSION_SOUNDS });
    readonly loading = signal(false);
    readonly storageWarning = signal(false);
    readonly syncWarning = signal(false);
    private generation = 0;
    private revision = 0;
    private cacheUpdatedAt = 0;
    private saveTimer: number | undefined;
    private saveChain: Promise<void> = Promise.resolve();

    constructor() {
        effect(() => this.startOwnerLoad(this.session.userId()));
        const storage = (event: StorageEvent) => this.onStorage(event);
        const online = () => this.flushCurrent();
        this.view?.addEventListener('storage', storage);
        this.view?.addEventListener('online', online);
        this.destroyRef.onDestroy(() => {
            this.view?.clearTimeout(this.saveTimer);
            this.view?.removeEventListener('storage', storage);
            this.view?.removeEventListener('online', online);
        });
    }

    update(
        updater: (current: SessionSoundPreferences) => SessionSoundPreferences,
        immediate = true,
    ): void {
        const next = normalizeSoundPreferences(updater(this.preferences())) ?? { ...DEFAULT_SESSION_SOUNDS };
        this.preferences.set(next);
        this.revision++;
        const owner = this.session.userId();
        if (!owner) {
            this.writeLegacy(next);
            return;
        }
        this.writeCache(owner, next, true, this.nextTimestamp());
        if (immediate) this.flushCurrent();
        else this.scheduleSave();
    }

    private startOwnerLoad(owner: string | null): void {
        const generation = ++this.generation;
        this.view?.clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        this.syncWarning.set(false);
        this.cacheUpdatedAt = 0;

        if (!owner) {
            this.preferences.set({ ...DEFAULT_SESSION_SOUNDS });
            this.loading.set(false);
            return;
        }

        let local = this.readCache(owner);
        if (!local) {
            const legacy = this.readLegacy();
            if (legacy) {
                local = { version: 1, preferences: legacy, pending: true, updatedAt: this.nextTimestamp() };
                this.writeCache(owner, legacy, true, local.updatedAt);
                this.removeLegacy();
            }
        }
        this.preferences.set(local?.preferences ?? { ...DEFAULT_SESSION_SOUNDS });
        this.loading.set(true);
        const revision = this.revision;
        void this.loadCloud(owner, generation, revision, local);
    }

    private async loadCloud(
        owner: string,
        generation: number,
        revision: number,
        local: CachedPreferences | null,
    ): Promise<void> {
        let operation: UserOperation;
        try { operation = this.session.capture(); }
        catch { if (this.isCurrent(owner, generation)) this.loading.set(false); return; }
        if (operation.userId !== owner) return;

        try {
            const { data, error } = await this.client.from('user_settings')
                .select('prefs')
                .eq('user_id', owner)
                .abortSignal(operation.signal)
                .maybeSingle();
            this.session.assertCurrent(operation);
            if (error) throw error;
            if (!this.isCurrent(owner, generation)) return;

            const cloudValue = this.cloudValue(data);
            const cloud = cloudValue === undefined ? null : normalizeSoundPreferences(cloudValue);
            if (cloudValue !== undefined && !cloud) this.syncWarning.set(true);

            // A click made while the request was in flight is always newer than
            // the fetched snapshot. Pending browser changes also win offline.
            if (this.revision !== revision || local?.pending) {
                this.flushCurrent();
            } else if (cloud) {
                this.preferences.set(cloud);
                this.writeCache(owner, cloud, false, this.nextTimestamp());
            } else if (local) {
                this.writeCache(owner, local.preferences, true, this.nextTimestamp());
                this.flushCurrent();
            }
        } catch {
            if (this.session.isCurrent(operation) && this.isCurrent(owner, generation)) {
                this.syncWarning.set(true);
            }
        } finally {
            if (this.isCurrent(owner, generation)) this.loading.set(false);
        }
    }

    private flushCurrent(): void {
        const owner = this.session.userId();
        if (!owner) return;
        const cached = this.readCache(owner);
        if (!cached?.pending) return;
        this.view?.clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        this.queueCloudSave(owner, cached.preferences, this.revision, cached.updatedAt);
    }

    private scheduleSave(): void {
        this.view?.clearTimeout(this.saveTimer);
        this.saveTimer = this.view?.setTimeout(() => {
            this.saveTimer = undefined;
            this.flushCurrent();
        }, SAVE_DELAY_MS);
    }

    private queueCloudSave(
        owner: string,
        preferences: SessionSoundPreferences,
        revision: number,
        updatedAt: number,
    ): void {
        this.saveChain = this.saveChain.catch(() => undefined).then(async () => {
            if (this.session.userId() !== owner) return;
            const operation = this.session.capture();
            const { error } = await this.client.rpc('set_my_session_sound_preferences', {
                p_preferences: preferences,
            }).abortSignal(operation.signal);
            this.session.assertCurrent(operation);
            if (error) throw error;
            if (this.session.userId() !== owner) return;
            const current = this.readCache(owner);
            if (this.revision === revision && current?.pending && current.updatedAt === updatedAt) {
                this.writeCache(owner, preferences, false, this.nextTimestamp());
            }
            this.syncWarning.set(false);
        }).catch(() => {
            if (this.session.userId() === owner) this.syncWarning.set(true);
        });
    }

    private onStorage(event: StorageEvent): void {
        const owner = this.session.userId();
        if (!owner || (event.key !== this.cacheKey(owner) && event.key !== null)) return;
        const cached = this.readCache(owner);
        if (!cached || cached.updatedAt <= this.cacheUpdatedAt) return;
        this.cacheUpdatedAt = cached.updatedAt;
        this.preferences.set(cached.preferences);
        this.revision++;
        if (cached.pending) this.flushCurrent();
    }

    private cloudValue(data: unknown): unknown | undefined {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
        const prefs = (data as Record<string, unknown>)['prefs'];
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return undefined;
        return (prefs as Record<string, unknown>)[CLOUD_KEY];
    }

    private readCache(owner: string): CachedPreferences | null {
        try {
            const raw = this.view?.localStorage.getItem(this.cacheKey(owner));
            if (!raw) return null;
            const value: unknown = JSON.parse(raw);
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            const record = value as Partial<CachedPreferences>;
            const preferences = normalizeSoundPreferences(record.preferences);
            if (!preferences || record.version !== 1 || typeof record.updatedAt !== 'number') return null;
            this.cacheUpdatedAt = Math.max(this.cacheUpdatedAt, record.updatedAt);
            return { version: 1, preferences, pending: record.pending === true, updatedAt: record.updatedAt };
        } catch {
            this.storageWarning.set(true);
            return null;
        }
    }

    private readLegacy(): SessionSoundPreferences | null {
        try {
            const raw = this.view?.localStorage.getItem(LEGACY_KEY) ?? null;
            return raw === null ? null : parseSoundPreferences(raw);
        } catch { this.storageWarning.set(true); return null; }
    }

    private writeLegacy(preferences: SessionSoundPreferences): void {
        try {
            this.view?.localStorage.setItem(LEGACY_KEY, JSON.stringify(preferences));
            this.storageWarning.set(false);
        } catch { this.storageWarning.set(true); }
    }

    private removeLegacy(): void {
        try { this.view?.localStorage.removeItem(LEGACY_KEY); }
        catch { this.storageWarning.set(true); }
    }

    private writeCache(
        owner: string,
        preferences: SessionSoundPreferences,
        pending: boolean,
        updatedAt: number,
    ): void {
        try {
            const record: CachedPreferences = { version: 1, preferences, pending, updatedAt };
            this.view?.localStorage.setItem(this.cacheKey(owner), JSON.stringify(record));
            this.cacheUpdatedAt = Math.max(this.cacheUpdatedAt, updatedAt);
            this.storageWarning.set(false);
        } catch { this.storageWarning.set(true); }
    }

    private cacheKey(owner: string): string { return `${CACHE_PREFIX}${owner}`; }
    private nextTimestamp(): number { return this.cacheUpdatedAt = Math.max(Date.now(), this.cacheUpdatedAt + 1); }
    private isCurrent(owner: string, generation: number): boolean {
        return generation === this.generation && this.session.userId() === owner;
    }
}
