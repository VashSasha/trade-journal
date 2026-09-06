import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import {
    DASHBOARD_LAYOUT_VERSION,
    DashboardWidgetId,
    DashboardWidgetPlacement,
    DEFAULT_DASHBOARD_LAYOUT,
    normalizeDashboardLayout,
} from './dashboard-layout.model';

interface CachedDashboardLayout {
    savedAt: number;
    widgets: DashboardWidgetPlacement[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'local-only';

const CACHE_PREFIX = 'nvzn_dashboard_layout_v1:';
const PAGE = 'dashboard';

/** Owner-scoped dashboard layout with immediate local persistence and debounced cloud sync. */
@Injectable()
export class DashboardLayoutService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly destroyRef = inject(DestroyRef);
    readonly widgets = signal<DashboardWidgetPlacement[]>(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
    readonly editing = signal(false);
    readonly loading = signal(false);
    readonly saveState = signal<SaveState>('idle');
    readonly error = signal<string | null>(null);
    private owner: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private localSavedAt = 0;

    constructor() {
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
            if (!this.owner || event.key !== CACHE_PREFIX + this.owner || !event.newValue) return;
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

    updatePositions(changes: readonly Partial<DashboardWidgetPlacement>[]): void {
        const byId = new Map(changes.map(change => [change.id, change]));
        this.commit(this.widgets().map(widget => {
            const change = byId.get(widget.id);
            return change ? { ...widget, ...change, id: widget.id, hidden: widget.hidden } : widget;
        }));
    }

    setVisible(id: DashboardWidgetId, visible: boolean): void {
        this.commit(this.widgets().map(widget => widget.id === id ? { ...widget, hidden: !visible } : widget));
    }

    reset(): void {
        this.commit(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
    }

    private commit(value: unknown): void {
        const widgets = normalizeDashboardLayout(value);
        this.widgets.set(widgets);
        this.error.set(null);
        this.localSavedAt = Date.now();
        this.writeLocal(widgets, this.localSavedAt);
        this.scheduleCloudSave();
    }

    private loadLocal(owner: string | null): void {
        this.localSavedAt = 0;
        if (!owner) {
            this.widgets.set(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
            return;
        }
        try {
            const cached = this.parseCache(window.localStorage.getItem(CACHE_PREFIX + owner));
            if (!cached) {
                this.widgets.set(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
                return;
            }
            this.localSavedAt = cached.savedAt;
            this.widgets.set(cached.widgets);
        } catch {
            this.widgets.set(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
        }
    }

    private async loadCloud(owner: string): Promise<void> {
        this.loading.set(true);
        const scope = this.session.capture();
        try {
            const { data, error } = await this.client.from('dashboard_layouts')
                .select('layout,schema_version,updated_at')
                .eq('user_id', owner)
                .eq('page', PAGE)
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
                const widgets = normalizeDashboardLayout(data.layout);
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
                ? 'Layout is saved on this device until the dashboard-layout migration is installed.'
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

    private async saveCloud(owner: string, widgets: DashboardWidgetPlacement[], savedAt: number): Promise<void> {
        if (!owner || owner !== this.session.userId()) return;
        const scope = this.session.capture();
        this.saveState.set('saving');
        try {
            const { data, error } = await this.client.from('dashboard_layouts').upsert({
                user_id: owner,
                page: PAGE,
                schema_version: DASHBOARD_LAYOUT_VERSION,
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
                ? 'Layout is saved on this device until the dashboard-layout migration is installed.'
                : 'Could not sync this layout. It remains saved on this device.');
        }
    }

    private writeLocal(widgets: DashboardWidgetPlacement[], savedAt: number): void {
        if (!this.owner) return;
        try {
            window.localStorage.setItem(CACHE_PREFIX + this.owner, JSON.stringify({ savedAt, widgets }));
        } catch {
            this.error.set('This layout could not be saved in browser storage.');
        }
    }

    private parseCache(raw: string | null): CachedDashboardLayout | null {
        if (!raw) return null;
        try {
            const value = JSON.parse(raw) as Partial<CachedDashboardLayout>;
            if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null;
            return { savedAt: value.savedAt, widgets: normalizeDashboardLayout(value.widgets) };
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
