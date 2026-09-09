import { DestroyRef, effect, inject, signal, WritableSignal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';

export interface PersistedWidgetPlacement {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    hidden: boolean;
}

export interface WidgetPlacementUpdate<TId extends string> {
    id: TId;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
}

export interface PersistedWidgetLayoutConfig<TPlacement extends PersistedWidgetPlacement> {
    page: string;
    schemaVersion: number;
    cachePrefix: string;
    defaultLayout: readonly TPlacement[];
    normalize: (value: unknown) => TPlacement[];
}

interface CachedWidgetLayout<TPlacement> {
    savedAt: number;
    widgets: TPlacement[];
}

export type WidgetLayoutSaveState = 'idle' | 'saving' | 'saved' | 'local-only';

/**
 * Shared persistence for configurable page layouts. Concrete page services
 * provide their own widget catalog and normalization rules while this class
 * owns local caching, cross-tab updates and owner-scoped cloud sync.
 */
export abstract class PersistedWidgetLayoutService<
    TPlacement extends PersistedWidgetPlacement,
> {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly destroyRef = inject(DestroyRef);

    readonly widgets: WritableSignal<TPlacement[]>;
    readonly editing = signal(false);
    readonly loading = signal(false);
    readonly saveState = signal<WidgetLayoutSaveState>('idle');
    readonly error = signal<string | null>(null);
    private owner: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private localSavedAt = 0;

    protected constructor(private readonly config: PersistedWidgetLayoutConfig<TPlacement>) {
        this.widgets = signal(config.normalize(config.defaultLayout));

        effect(() => {
            const owner = this.session.userId();
            if (owner === this.owner) return;
            this.owner = owner;
            this.editing.set(false);
            this.error.set(null);
            this.loadLocal(owner);
            if (owner) void this.loadCloud(owner);
        });

        const onOnline = () => {
            if (this.owner) void this.saveCloud(this.owner, this.widgets(), this.localSavedAt);
        };
        const onStorage = (event: StorageEvent) => {
            if (!this.owner || event.key !== config.cachePrefix + this.owner || !event.newValue) return;
            const cached = this.parseCache(event.newValue);
            if (!cached || cached.savedAt <= this.localSavedAt) return;
            this.localSavedAt = cached.savedAt;
            this.widgets.set(cached.widgets);
        };

        window.addEventListener('online', onOnline);
        window.addEventListener('storage', onStorage);
        this.destroyRef.onDestroy(() => {
            if (this.timer) clearTimeout(this.timer);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('storage', onStorage);
        });
    }

    updatePositions(changes: readonly WidgetPlacementUpdate<TPlacement['id']>[]): void {
        const byId = new Map(changes.map(change => [change.id, change]));
        this.commit(this.widgets().map(widget => {
            const change = byId.get(widget.id);
            return change ? { ...widget, ...change, id: widget.id, hidden: widget.hidden } : widget;
        }));
    }

    setVisible(id: TPlacement['id'], visible: boolean): void {
        this.commit(this.widgets().map(widget => widget.id === id
            ? { ...widget, hidden: !visible }
            : widget));
    }

    reset(): void {
        this.commit(this.config.defaultLayout);
    }

    private commit(value: unknown): void {
        const widgets = this.config.normalize(value);
        this.widgets.set(widgets);
        this.error.set(null);
        this.localSavedAt = Date.now();
        this.writeLocal(widgets, this.localSavedAt);
        this.scheduleCloudSave();
    }

    private loadLocal(owner: string | null): void {
        this.localSavedAt = 0;
        if (!owner) {
            this.widgets.set(this.config.normalize(this.config.defaultLayout));
            return;
        }
        try {
            const cached = this.parseCache(window.localStorage.getItem(this.config.cachePrefix + owner));
            if (!cached) {
                this.widgets.set(this.config.normalize(this.config.defaultLayout));
                return;
            }
            this.localSavedAt = cached.savedAt;
            this.widgets.set(cached.widgets);
        } catch {
            this.widgets.set(this.config.normalize(this.config.defaultLayout));
        }
    }

    private async loadCloud(owner: string): Promise<void> {
        this.loading.set(true);
        const scope = this.session.capture();
        try {
            const { data, error } = await this.client.from('dashboard_layouts')
                .select('layout,schema_version,updated_at')
                .eq('user_id', owner)
                .eq('page', this.config.page)
                .abortSignal(scope.signal)
                .maybeSingle();
            this.session.assertCurrent(scope);
            if (error) throw error;
            if (!data) {
                if (this.localSavedAt) await this.saveCloud(owner, this.widgets(), this.localSavedAt);
                return;
            }

            const remoteAt = Date.parse(data.updated_at as string);
            if (Number.isFinite(remoteAt) && remoteAt >= this.localSavedAt) {
                const widgets = this.config.normalize(data.layout);
                this.widgets.set(widgets);
                this.localSavedAt = remoteAt;
                this.writeLocal(widgets, remoteAt);
                this.saveState.set('saved');
            } else if (this.localSavedAt) {
                await this.saveCloud(owner, this.widgets(), this.localSavedAt);
            }
        } catch (error) {
            if (!this.session.isCurrent(scope)) return;
            this.saveState.set('local-only');
            this.error.set(this.isMissingTable(error)
                ? 'Layout is saved on this device until the layout-storage migration is installed.'
                : 'Cloud layout is unavailable. Your layout is still saved on this device.');
        } finally {
            if (this.session.isCurrent(scope)) this.loading.set(false);
        }
    }

    private scheduleCloudSave(): void {
        if (this.timer) clearTimeout(this.timer);
        const owner = this.owner;
        if (!owner) return;
        this.saveState.set('saving');
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.saveCloud(owner, this.widgets(), this.localSavedAt);
        }, 650);
    }

    private async saveCloud(owner: string, widgets: TPlacement[], savedAt: number): Promise<void> {
        if (!owner || owner !== this.session.userId()) return;
        const scope = this.session.capture();
        this.saveState.set('saving');
        try {
            const { data, error } = await this.client.from('dashboard_layouts').upsert({
                user_id: owner,
                page: this.config.page,
                schema_version: this.config.schemaVersion,
                layout: widgets,
            }, { onConflict: 'user_id,page' }).select('updated_at').abortSignal(scope.signal).single();
            this.session.assertCurrent(scope);
            if (error) throw error;
            if (this.localSavedAt === savedAt) {
                const serverSavedAt = Date.parse(data.updated_at as string);
                if (Number.isFinite(serverSavedAt)) {
                    this.localSavedAt = serverSavedAt;
                    this.writeLocal(widgets, serverSavedAt);
                }
                this.saveState.set('saved');
            }
            this.error.set(null);
        } catch (error) {
            if (!this.session.isCurrent(scope)) return;
            this.saveState.set('local-only');
            this.error.set(this.isMissingTable(error)
                ? 'Layout is saved on this device until the layout-storage migration is installed.'
                : 'Could not sync this layout. It remains saved on this device.');
        }
    }

    private writeLocal(widgets: TPlacement[], savedAt: number): void {
        if (!this.owner) return;
        try {
            window.localStorage.setItem(
                this.config.cachePrefix + this.owner,
                JSON.stringify({ savedAt, widgets }),
            );
        } catch {
            this.error.set('This layout could not be saved in browser storage.');
        }
    }

    private parseCache(raw: string | null): CachedWidgetLayout<TPlacement> | null {
        if (!raw) return null;
        try {
            const value = JSON.parse(raw) as Partial<CachedWidgetLayout<TPlacement>>;
            if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null;
            return { savedAt: value.savedAt, widgets: this.config.normalize(value.widgets) };
        } catch {
            return null;
        }
    }

    private isMissingTable(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const code = (error as { code?: unknown }).code;
        return code === '42P01' || code === 'PGRST205';
    }
}
