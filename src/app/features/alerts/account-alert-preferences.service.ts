import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../core/services/user-session.service';
import {
    parseMarketEventAlertPreferences,
    MarketEventAlertPreferences,
} from './market-event-alerts.utils';
import {
    parsePerformanceAlertPreferences,
    PerformanceAlertPreferences,
} from './performance-alerts.utils';
import { LiveCoachPreferences } from '../live-coach/live-coach.models';
import { parseLiveCoachPreferences } from '../live-coach/live-coach.utils';

import { parseSessionPreferences, SessionPreferences } from '../sessions/session-preferences';

type PreferenceKind = 'performance' | 'market' | 'coach' | 'sessions';

interface LocalPreference<T> {
    value: T;
    exists: boolean;
    pending: boolean;
}

const PERFORMANCE_KEY = 'nvzn_performance_alert_preferences_v1:';
const MARKET_KEY = 'nvzn_market_event_alerts_v1:';
const SESSIONS_KEY = 'nvzn_session_schedule_v1:';
const CLOUD_SESSIONS = 'session_schedule';
const COACH_KEY = 'nvzn_live_coach_preferences_v1:';
const PENDING_KEY = 'nvzn_account_alert_preferences_pending_v1:';
const CLOUD_PERFORMANCE = 'performance_alerts';
const CLOUD_MARKET = 'market_event_alerts';
const CLOUD_COACH = 'live_coach';

/** Portable alert settings synced through user_settings; device capabilities stay local. */
@Injectable({ providedIn: 'root' })
export class AccountAlertPreferencesService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    readonly performance = signal(parsePerformanceAlertPreferences(null));
    readonly marketEvents = signal(parseMarketEventAlertPreferences(null));
    readonly sessions = signal(parseSessionPreferences(null));
    readonly liveCoach = signal(parseLiveCoachPreferences(null));
    readonly loading = signal(false);
    readonly syncWarning = signal(false);
    readonly storageWarning = signal(false);
    private owner: string | null = null;
    private generation = 0;
    private performanceRevision = 0;
    private marketRevision = 0;
    private coachRevision = 0;
    private sessionsRevision = 0;
    private performanceSave: Promise<void> = Promise.resolve();
    private marketSave: Promise<void> = Promise.resolve();
    private coachSave: Promise<void> = Promise.resolve();
    private sessionsSave: Promise<void> = Promise.resolve();

    constructor() {
        effect(() => this.startOwnerLoad(this.session.userId()));
        const storage = (event: StorageEvent) => this.onStorage(event);
        const online = () => {
            if (this.owner) this.startOwnerLoad(this.owner);
        };
        this.view?.addEventListener('storage', storage);
        this.view?.addEventListener('online', online);
        this.destroyRef.onDestroy(() => {
            this.view?.removeEventListener('storage', storage);
            this.view?.removeEventListener('online', online);
        });
    }

    updatePerformance(updater: (current: PerformanceAlertPreferences) => PerformanceAlertPreferences): void {
        const next = parsePerformanceAlertPreferences(JSON.stringify(updater(this.performance())));
        this.performance.set(next);
        this.performanceRevision++;
        if (!this.owner) return;
        this.markPending('performance', this.owner);
        this.writeLocal('performance', this.owner, next);
        this.queuePerformanceSave(this.owner);
    }

    updateMarketAccount(updater: (current: MarketEventAlertPreferences) => MarketEventAlertPreferences): void {
        const next = parseMarketEventAlertPreferences(JSON.stringify(updater(this.marketEvents())));
        this.marketEvents.set(next);
        this.marketRevision++;
        if (!this.owner) return;
        this.markPending('market', this.owner);
        this.writeLocal('market', this.owner, next);
        this.queueMarketSave(this.owner);
    }

    /** Notification permission and opt-in are browser-profile capabilities, not account state. */
    updateMarketDevice(updater: (current: MarketEventAlertPreferences) => MarketEventAlertPreferences): void {
        const next = parseMarketEventAlertPreferences(JSON.stringify(updater(this.marketEvents())));
        this.marketEvents.set(next);
        if (this.owner) this.writeLocal('market', this.owner, next);
    }

    updateLiveCoach(updater: (current: LiveCoachPreferences) => LiveCoachPreferences): void {
        const next = parseLiveCoachPreferences(JSON.stringify(updater(this.liveCoach())));
        this.liveCoach.set(next);
        this.coachRevision++;
        if (!this.owner) return;
        this.markPending('coach', this.owner);
        this.writeLocal('coach', this.owner, next);
        this.queueCoachSave(this.owner);
    }

    updateSessions(updater: (current: SessionPreferences) => SessionPreferences): void {
        const next = parseSessionPreferences(JSON.stringify(updater(this.sessions())));
        this.sessions.set(next);
        this.sessionsRevision++;
        if (!this.owner) return;
        this.markPending('sessions', this.owner);
        this.writeLocal('sessions', this.owner, next);
        this.queueSessionsSave(this.owner);
    }

    private startOwnerLoad(owner: string | null): void {
        const generation = ++this.generation;
        this.owner = owner;
        this.syncWarning.set(false);
        if (!owner) {
            this.performance.set(parsePerformanceAlertPreferences(null));
            this.marketEvents.set(parseMarketEventAlertPreferences(null));
            this.liveCoach.set(parseLiveCoachPreferences(null));
            this.sessions.set(parseSessionPreferences(null));
            this.loading.set(false);
            return;
        }

        const localPerformance = this.readPerformance(owner);
        const localMarket = this.readMarket(owner);
        const localCoach = this.readCoach(owner);
        const localSessions = this.readSessions(owner);
        this.performance.set(localPerformance.value);
        this.marketEvents.set(localMarket.value);
        this.liveCoach.set(localCoach.value);
        this.sessions.set(localSessions.value);
        this.loading.set(true);
        void this.loadCloud(
            owner,
            generation,
            this.performanceRevision,
            this.marketRevision,
            this.coachRevision,
            localPerformance,
            localMarket,
            localCoach,
            this.sessionsRevision,
            localSessions,
        );
    }

    private async loadCloud(
        owner: string,
        generation: number,
        performanceRevision: number,
        marketRevision: number,
        coachRevision: number,
        localPerformance: LocalPreference<PerformanceAlertPreferences>,
        localMarket: LocalPreference<MarketEventAlertPreferences>,
        localCoach: LocalPreference<LiveCoachPreferences>,
        sessionsRevision: number,
        localSessions: LocalPreference<SessionPreferences>,
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

            const prefs = this.cloudPreferences(data);
            this.reconcilePerformance(owner, prefs, localPerformance, performanceRevision);
            this.reconcileMarket(owner, prefs, localMarket, marketRevision);
            this.reconcileCoach(owner, prefs, localCoach, coachRevision);
            this.reconcileSessions(owner, prefs, localSessions, sessionsRevision);
        } catch {
            if (this.session.isCurrent(operation) && this.isCurrent(owner, generation)) {
                this.syncWarning.set(true);
            }
        } finally {
            if (this.isCurrent(owner, generation)) this.loading.set(false);
        }
    }

    private reconcilePerformance(
        owner: string,
        cloud: Record<string, unknown>,
        local: LocalPreference<PerformanceAlertPreferences>,
        revision: number,
    ): void {
        if (this.performanceRevision !== revision || local.pending) {
            this.queuePerformanceSave(owner);
            return;
        }
        const value = this.objectValue(cloud, CLOUD_PERFORMANCE);
        if (value) {
            const preferences = parsePerformanceAlertPreferences(JSON.stringify(value));
            this.performance.set(preferences);
            this.writeLocal('performance', owner, preferences);
        } else if (local.exists) {
            this.markPending('performance', owner);
            this.queuePerformanceSave(owner);
        }
    }

    private reconcileMarket(
        owner: string,
        cloud: Record<string, unknown>,
        local: LocalPreference<MarketEventAlertPreferences>,
        revision: number,
    ): void {
        if (this.marketRevision !== revision || local.pending) {
            this.queueMarketSave(owner);
            return;
        }
        const value = this.objectValue(cloud, CLOUD_MARKET);
        if (value) {
            const preferences = parseMarketEventAlertPreferences(JSON.stringify({
                ...value,
                desktopNotifications: local.value.desktopNotifications,
            }));
            this.marketEvents.set(preferences);
            this.writeLocal('market', owner, preferences);
        } else if (local.exists) {
            this.markPending('market', owner);
            this.queueMarketSave(owner);
        }
    }

    private reconcileCoach(
        owner: string,
        cloud: Record<string, unknown>,
        local: LocalPreference<LiveCoachPreferences>,
        revision: number,
    ): void {
        if (this.coachRevision !== revision || local.pending) {
            this.queueCoachSave(owner);
            return;
        }
        const value = this.objectValue(cloud, CLOUD_COACH);
        if (value) {
            const preferences = parseLiveCoachPreferences(JSON.stringify(value));
            this.liveCoach.set(preferences);
            this.writeLocal('coach', owner, preferences);
        } else if (local.exists) {
            this.markPending('coach', owner);
            this.queueCoachSave(owner);
        }
    }

    private reconcileSessions(
        owner: string,
        cloud: Record<string, unknown>,
        local: LocalPreference<SessionPreferences>,
        revision: number,
    ): void {
        if (this.sessionsRevision !== revision || local.pending) {
            this.queueSessionsSave(owner);
            return;
        }
        const value = this.objectValue(cloud, CLOUD_SESSIONS);
        if (value) {
            const preferences = parseSessionPreferences(JSON.stringify(value));
            this.sessions.set(preferences);
            this.writeLocal('sessions', owner, preferences);
        } else if (local.exists) {
            this.markPending('sessions', owner);
            this.queueSessionsSave(owner);
        }
    }

    private queuePerformanceSave(owner: string): void {
        const preferences = structuredClone(this.performance());
        const revision = this.performanceRevision;
        this.performanceSave = this.performanceSave.catch(() => undefined).then(() =>
            this.saveCloud('performance', owner, preferences, revision));
    }

    private queueMarketSave(owner: string): void {
        const current = this.marketEvents();
        const preferences = {
            enabled: current.enabled,
            leadMinutes: current.leadMinutes,
            highOnly: current.highOnly,
        };
        const revision = this.marketRevision;
        this.marketSave = this.marketSave.catch(() => undefined).then(() =>
            this.saveCloud('market', owner, preferences, revision));
    }

    private queueCoachSave(owner: string): void {
        const preferences = structuredClone(this.liveCoach());
        const revision = this.coachRevision;
        this.coachSave = this.coachSave.catch(() => undefined).then(() =>
            this.saveCloud('coach', owner, preferences, revision));
    }

    private queueSessionsSave(owner: string): void {
        const preferences = structuredClone(this.sessions());
        const revision = this.sessionsRevision;
        this.sessionsSave = this.sessionsSave.catch(() => undefined).then(() =>
            this.saveCloud('sessions', owner, preferences, revision));
    }

    private async saveCloud(
        kind: PreferenceKind,
        owner: string,
        preferences: unknown,
        revision: number,
    ): Promise<void> {
        if (owner !== this.session.userId()) return;
        const operation = this.session.capture();
        try {
            const { error } = await this.client.rpc('set_my_account_alert_preferences', {
                p_kind: this.cloudKey(kind),
                p_preferences: preferences,
            }).abortSignal(operation.signal);
            this.session.assertCurrent(operation);
            if (error) throw error;
            const currentRevision = kind === 'performance'
                ? this.performanceRevision
                : kind === 'market' ? this.marketRevision : kind === 'coach' ? this.coachRevision : this.sessionsRevision;
            if (currentRevision === revision) this.clearPending(kind, owner);
            this.syncWarning.set(this.hasPending(owner));
        } catch {
            if (this.session.isCurrent(operation) && this.owner === owner) this.syncWarning.set(true);
        }
    }

    private onStorage(event: StorageEvent): void {
        if (!this.owner) return;
        const performanceKey = this.localKey('performance', this.owner);
        const marketKey = this.localKey('market', this.owner);
        const coachKey = this.localKey('coach', this.owner);
        const sessionsKey = this.localKey('sessions', this.owner);
        if (event.key === performanceKey || event.key === this.pendingKey('performance', this.owner)) {
            const local = this.readPerformance(this.owner);
            if (local.exists) {
                this.performance.set(local.value);
                this.performanceRevision++;
                if (local.pending) this.queuePerformanceSave(this.owner);
            }
        }
        if (event.key === marketKey || event.key === this.pendingKey('market', this.owner)) {
            const local = this.readMarket(this.owner);
            if (local.exists) {
                this.marketEvents.set(local.value);
                this.marketRevision++;
                if (local.pending) this.queueMarketSave(this.owner);
            }
        }
        if (event.key === coachKey || event.key === this.pendingKey('coach', this.owner)) {
            const local = this.readCoach(this.owner);
            if (local.exists) {
                this.liveCoach.set(local.value);
                this.coachRevision++;
                if (local.pending) this.queueCoachSave(this.owner);
            }
        }
        if (event.key === sessionsKey || event.key === this.pendingKey('sessions', this.owner)) {
            const local = this.readSessions(this.owner);
            if (local.exists) {
                this.sessions.set(local.value);
                this.sessionsRevision++;
                if (local.pending) this.queueSessionsSave(this.owner);
            }
        }
    }

    private readPerformance(owner: string): LocalPreference<PerformanceAlertPreferences> {
        const raw = this.readLocal('performance', owner);
        return {
            value: parsePerformanceAlertPreferences(raw),
            exists: raw !== null,
            pending: this.isPending('performance', owner),
        };
    }

    private readMarket(owner: string): LocalPreference<MarketEventAlertPreferences> {
        const raw = this.readLocal('market', owner);
        return {
            value: parseMarketEventAlertPreferences(raw),
            exists: raw !== null,
            pending: this.isPending('market', owner),
        };
    }

    private readCoach(owner: string): LocalPreference<LiveCoachPreferences> {
        const raw = this.readLocal('coach', owner);
        return {
            value: parseLiveCoachPreferences(raw),
            exists: raw !== null,
            pending: this.isPending('coach', owner),
        };
    }

    private readSessions(owner: string): LocalPreference<SessionPreferences> {
        const raw = this.readLocal('sessions', owner);
        return {
            value: parseSessionPreferences(raw),
            exists: raw !== null,
            pending: this.isPending('sessions', owner),
        };
    }

    private readLocal(kind: PreferenceKind, owner: string): string | null {
        try { return this.view?.localStorage.getItem(this.localKey(kind, owner)) ?? null; }
        catch { this.storageWarning.set(true); return null; }
    }

    private writeLocal(kind: PreferenceKind, owner: string, preferences: unknown): void {
        try {
            this.view?.localStorage.setItem(this.localKey(kind, owner), JSON.stringify(preferences));
            this.storageWarning.set(false);
        } catch { this.storageWarning.set(true); }
    }

    private markPending(kind: PreferenceKind, owner: string): void {
        try { this.view?.localStorage.setItem(this.pendingKey(kind, owner), '1'); }
        catch { this.storageWarning.set(true); }
    }

    private clearPending(kind: PreferenceKind, owner: string): void {
        try { this.view?.localStorage.removeItem(this.pendingKey(kind, owner)); }
        catch { this.storageWarning.set(true); }
    }

    private isPending(kind: PreferenceKind, owner: string): boolean {
        try { return this.view?.localStorage.getItem(this.pendingKey(kind, owner)) === '1'; }
        catch { this.storageWarning.set(true); return false; }
    }

    private hasPending(owner: string): boolean {
        return this.isPending('performance', owner)
            || this.isPending('market', owner)
            || this.isPending('coach', owner)
            || this.isPending('sessions', owner);
    }

    private cloudPreferences(data: unknown): Record<string, unknown> {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        const prefs = (data as Record<string, unknown>)['prefs'];
        return prefs && typeof prefs === 'object' && !Array.isArray(prefs)
            ? prefs as Record<string, unknown>
            : {};
    }

    private objectValue(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
        const value = source[key];
        if (value === undefined) return null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            this.syncWarning.set(true);
            return null;
        }
        return value as Record<string, unknown>;
    }

    private localKey(kind: PreferenceKind, owner: string): string {
        const prefix = kind === 'performance' ? PERFORMANCE_KEY : kind === 'market' ? MARKET_KEY : kind === 'coach' ? COACH_KEY : SESSIONS_KEY;
        return `${prefix}${owner}`;
    }

    private cloudKey(kind: PreferenceKind): string {
        return kind === 'performance' ? CLOUD_PERFORMANCE : kind === 'market' ? CLOUD_MARKET : kind === 'coach' ? CLOUD_COACH : CLOUD_SESSIONS;
    }

    private pendingKey(kind: PreferenceKind, owner: string): string {
        return `${PENDING_KEY}${owner}:${kind}`;
    }

    private isCurrent(owner: string, generation: number): boolean {
        return generation === this.generation && owner === this.session.userId();
    }
}
