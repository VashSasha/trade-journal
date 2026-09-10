import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { TradovateService } from '../../core/services/tradovate.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { AlertCenterService } from '../alerts/alert-center.service';
import { PerformanceAlertsService } from '../alerts/performance-alerts.service';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { LiveCoachNarratorService } from './live-coach-narrator.service';
import { LiveCoachNarration, LiveCoachPreferences } from './live-coach.models';
import {
    buildLiveCoachNarration,
    liveCoachEventBucket,
    liveCoachEventEnabled,
} from './live-coach.utils';

const GROUP_WINDOW_MS = 900;
const MAX_PROCESSED_EVENTS = 250;

interface PendingBucket {
    events: TradovateLivePositionEvent[];
    timer: ReturnType<typeof setTimeout>;
}

/** Turns normalized broker events into concise, copy-trade-aware observations. */
@Injectable({ providedIn: 'root' })
export class LiveCoachService {
    private readonly preferenceStore = inject(AccountAlertPreferencesService);
    private readonly live = inject(TradovateLiveService);
    private readonly tradovate = inject(TradovateService);
    private readonly session = inject(UserSessionService);
    private readonly alerts = inject(AlertCenterService);
    private readonly performanceAlerts = inject(PerformanceAlertsService);
    private readonly narrator = inject(LiveCoachNarratorService);
    private readonly destroyRef = inject(DestroyRef);

    readonly preferences = this.preferenceStore.liveCoach;
    readonly preferencesLoading = this.preferenceStore.loading;
    readonly syncWarning = this.preferenceStore.syncWarning;
    readonly storageWarning = this.preferenceStore.storageWarning;
    readonly supported = this.narrator.supported;
    readonly narratorState = this.narrator.state;
    readonly error = this.narrator.error;
    readonly lastComment = signal<LiveCoachNarration | null>(null);
    readonly lastSpokenText = signal<string | null>(null);
    readonly liveState = this.live.state;
    readonly liveStatus = this.live.statusLabel;
    readonly liveDetail = this.live.statusDetail;

    private owner: string | null = null;
    private readonly processed = new Set<string>();
    private readonly processedOrder: string[] = [];
    private readonly pending = new Map<string, PendingBucket>();
    private readonly lastSpokenAt = new Map<string, number>();
    private readonly contractNames = new Map<string, Promise<string | null>>();
    private lastPerformanceEventId = 0;
    private guardrailTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            const enabled = this.preferences().enabled;
            this.live.setRequested('live-coach', !!owner && enabled);
            if (owner !== this.owner) untracked(() => this.reset(owner));
            if (!enabled) untracked(() => this.clearPending());
        });

        effect(() => {
            const event = this.performanceAlerts.event();
            const preferences = this.preferences();
            if (!event || event.id === this.lastPerformanceEventId) return;
            this.lastPerformanceEventId = event.id;
            if (!preferences.enabled || !preferences.guardrails) return;
            const owner = this.owner;
            this.guardrailTimer = setTimeout(() => {
                this.guardrailTimer = null;
                if (!owner || owner !== this.owner || !this.preferences().enabled || !this.preferences().guardrails) return;
                this.lastSpokenText.set(event.text);
                void this.narrator.speak(event.text, this.preferences().speechRate);
            }, 1_600);
        });

        effect(() => {
            const events = this.live.positionEvents();
            const preferences = this.preferences();
            for (const event of events) {
                if (!this.markProcessed(event.eventId)) continue;
                if (preferences.enabled && liveCoachEventEnabled(event.kind, preferences)) {
                    untracked(() => this.buffer(event));
                }
            }
        });

        this.destroyRef.onDestroy(() => {
            this.live.setRequested('live-coach', false);
            this.clearPending();
            this.narrator.stop();
        });
    }

    update(updater: (current: LiveCoachPreferences) => LiveCoachPreferences): void {
        this.preferenceStore.updateLiveCoach(updater);
    }

    setEnabled(enabled: boolean): void {
        if (enabled && !this.supported()) return;
        this.update(current => ({ ...current, enabled }));
        if (!enabled) this.narrator.stop();
    }

    setEvent(kind: 'entries' | 'sizing' | 'exits' | 'guardrails', enabled: boolean): void {
        this.update(current => ({ ...current, [kind]: enabled }));
    }

    setCooldown(seconds: number): void {
        if (!Number.isFinite(seconds)) return;
        this.update(current => ({ ...current, cooldownSeconds: Math.round(seconds) }));
    }

    setSpeechRate(rate: number): void {
        if (!Number.isFinite(rate)) return;
        this.update(current => ({ ...current, speechRate: Math.round(rate * 10) / 10 }));
    }

    async preview(): Promise<void> {
        await this.narrator.speak(
            'Live Coach is ready. Position updates will be short and focused.',
            this.preferences().speechRate,
        );
    }

    private buffer(event: TradovateLivePositionEvent): void {
        const key = liveCoachEventBucket(event);
        const existing = this.pending.get(key);
        if (existing) clearTimeout(existing.timer);
        const events = [...(existing?.events ?? []), event];
        const timer = setTimeout(() => void this.flush(key), GROUP_WINDOW_MS);
        this.pending.set(key, { events, timer });
    }

    private async flush(key: string): Promise<void> {
        const bucket = this.pending.get(key);
        if (!bucket) return;
        this.pending.delete(key);
        const owner = this.owner;
        const preferences = this.preferences();
        if (!preferences.enabled || !bucket.events.some(event => liveCoachEventEnabled(event.kind, preferences))) return;

        const contractName = await this.resolveContractName(bucket.events[0]);
        if (!owner || owner !== this.owner || owner !== this.session.userId() || !this.preferences().enabled) return;
        const narration = buildLiveCoachNarration(bucket.events, contractName);
        if (!narration) return;

        const now = Date.now();
        const previous = this.lastSpokenAt.get(narration.key) ?? 0;
        if (now - previous < this.preferences().cooldownSeconds * 1000) return;
        this.lastSpokenAt.set(narration.key, now);
        this.lastComment.set(narration);
        this.lastSpokenText.set(narration.text);
        this.alerts.publish({ tone: narration.tone, title: narration.title, text: narration.text });
        await this.narrator.speak(narration.text, this.preferences().speechRate);
    }

    private resolveContractName(event: TradovateLivePositionEvent): Promise<string | null> {
        if (event.contractId === null) return Promise.resolve(null);
        const key = `${event.connectionId}:${event.contractId}`;
        const cached = this.contractNames.get(key);
        if (cached) return cached;
        const request = firstValueFrom(this.tradovate.getContractForConnection(
            event.connectionId,
            event.contractId,
        ).pipe(
            timeout(2_000),
            catchError(() => of(null)),
        )).then(contract => contract?.name?.trim() || null);
        this.contractNames.set(key, request);
        return request;
    }

    private markProcessed(id: string): boolean {
        if (this.processed.has(id)) return false;
        this.processed.add(id);
        this.processedOrder.push(id);
        if (this.processedOrder.length > MAX_PROCESSED_EVENTS) {
            this.processed.delete(this.processedOrder.shift()!);
        }
        return true;
    }

    private reset(owner: string | null): void {
        this.owner = owner;
        this.processed.clear();
        this.processedOrder.length = 0;
        this.lastSpokenAt.clear();
        this.contractNames.clear();
        this.lastComment.set(null);
        this.lastSpokenText.set(null);
        this.lastPerformanceEventId = 0;
        this.clearPending();
        this.narrator.stop();
    }

    private clearPending(): void {
        for (const bucket of this.pending.values()) clearTimeout(bucket.timer);
        this.pending.clear();
        if (this.guardrailTimer) clearTimeout(this.guardrailTimer);
        this.guardrailTimer = null;
    }
}
