import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { firstValueFrom, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { TradeService } from '../../core/services/trade.service';
import { TradovateService } from '../../core/services/tradovate.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { AlertCenterService } from '../alerts/alert-center.service';
import { PerformanceAlertsService } from '../alerts/performance-alerts.service';
import { TradovateLivePositionEvent } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { LiveCoachNarratorService } from './live-coach-narrator.service';
import { LiveCoachAiState, LiveCoachNarration, LiveCoachPreferences, LiveCoachReply, LiveCoachVoice } from './live-coach.models';
import {
    buildLiveCoachAiPayload,
    buildLiveCoachNarration,
    liveCoachEventBucket,
    liveCoachEventEnabled,
    normalizeLiveCoachAiText,
    shouldPersonalizeLiveCoachEvent,
} from './live-coach.utils';

const GROUP_WINDOW_MS = 900;
const MAX_PROCESSED_EVENTS = 250;
const AI_COMMENT_TIMEOUT_MS = 12_000;

interface PendingBucket {
    events: TradovateLivePositionEvent[];
    timer: ReturnType<typeof setTimeout>;
    sequence: number;
}

/** Turns normalized broker events into concise, copy-trade-aware observations. */
@Injectable({ providedIn: 'root' })
export class LiveCoachService {
    private readonly preferenceStore = inject(AccountAlertPreferencesService);
    private readonly live = inject(TradovateLiveService);
    private readonly tradovate = inject(TradovateService);
    private readonly trades = inject(TradeService);
    private readonly ai = inject(OpenAiService);
    private readonly access = inject(AccessPolicyService);
    private readonly session = inject(UserSessionService);
    private readonly alerts = inject(AlertCenterService);
    private readonly performanceAlerts = inject(PerformanceAlertsService);
    private readonly narrator = inject(LiveCoachNarratorService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly document = inject(DOCUMENT);

    readonly preferences = this.preferenceStore.liveCoach;
    readonly preferencesLoading = this.preferenceStore.loading;
    readonly syncWarning = this.preferenceStore.syncWarning;
    readonly storageWarning = this.preferenceStore.storageWarning;
    readonly supported = this.narrator.supported;
    readonly narratorState = this.narrator.state;
    readonly error = this.narrator.error;
    readonly audioReady = this.narrator.audioReady;
    readonly voiceFallback = this.narrator.voiceFallback;
    readonly voiceWarning = signal<string | null>(null);
    readonly previewing = signal(false);
    readonly paused = signal(false);
    readonly recentComments = signal<readonly { text: string; time: number; personalized: boolean }[]>([]);
    readonly lastComment = signal<LiveCoachNarration | null>(null);
    readonly lastSpokenText = signal<string | null>(null);
    readonly aiState = signal<LiveCoachAiState>('off');
    readonly aiAvailable = computed(() => this.access.canAct('ai'));
    readonly aiStatusLabel = computed(() => {
        if (!this.preferences().aiCommentary) return 'Off';
        if (!this.preferences().enabled) return 'Coach is off';
        if (this.paused()) return 'Paused in this tab';
        if (!this.aiAvailable()) return 'Paid plan required';
        if (this.aiState() === 'thinking') return 'Personalizing…';
        if (this.aiState() === 'fallback') return 'Factual fallback active';
        return 'Ready';
    });
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
    private aiController: AbortController | null = null;
    private aiGeneration = 0;
    private sequence = 0;
    private guardrailUntil = 0;

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            const enabled = this.preferences().enabled;
            this.live.setRequested('live-coach', !!owner && enabled);
            if (owner !== this.owner) untracked(() => this.reset(owner));
            if (!enabled || this.paused() || !this.access.canAct('sync') || this.liveState() !== 'live') {
                untracked(() => this.interrupt());
            }
        });

        effect(() => {
            const enabled = this.preferences().enabled
                && this.preferences().aiCommentary
                && this.aiAvailable();
            this.preferences().voice;
            this.cancelAi();
            if (!enabled) {
                this.aiState.set('off');
            } else {
                this.aiState.set('ready');
            }
        });

        effect(() => {
            const event = this.performanceAlerts.event();
            const preferences = this.preferences();
            if (!preferences.guardrails && this.guardrailUntil > 0) {
                untracked(() => this.interrupt());
            }
            if (!event || event.id === this.lastPerformanceEventId) return;
            this.lastPerformanceEventId = event.id;
            if (!this.owner || !preferences.enabled || !preferences.guardrails || this.paused()
                || !this.access.canAct('sync') || this.liveState() !== 'live') return;
            this.interrupt();
            this.guardrailUntil = Infinity;
            const sequence = this.sequence;
            this.aiState.set(preferences.aiCommentary && this.aiAvailable() ? 'ready' : 'off');
            const owner = this.owner;
            this.guardrailTimer = setTimeout(() => {
                this.guardrailTimer = null;
                if (!owner || owner !== this.owner || this.paused() || !this.preferences().enabled || !this.preferences().guardrails || this.liveState() !== 'live') return;
                this.recordComment(event.text, false);
                void this.narrator.speak(event.text, this.preferences().speechRate).finally(() => {
                    if (sequence === this.sequence) this.guardrailUntil = Date.now() + 500;
                });
            }, 1_600);
        });

        effect(() => {
            const events = this.live.positionEvents();
            const preferences = this.preferences();
            for (const event of events) {
                if (!this.markProcessed(event.eventId)) continue;
                if (preferences.enabled && !this.paused() && this.liveState() === 'live') {
                    untracked(() => this.buffer(event));
                }
            }
        });

        const activate = () => {
            if (this.preferences().enabled && !this.audioReady() && this.preferences().voice !== 'browser') {
                void this.narrator.activate();
            }
        };
        this.document.addEventListener('pointerdown', activate);
        this.document.addEventListener('keydown', activate);
        this.destroyRef.onDestroy(() => {
            this.document.removeEventListener('pointerdown', activate);
            this.document.removeEventListener('keydown', activate);
            this.live.setRequested('live-coach', false);
            this.interrupt();
        });
    }

    update(updater: (current: LiveCoachPreferences) => LiveCoachPreferences): void {
        this.preferenceStore.updateLiveCoach(updater);
    }

    setEnabled(enabled: boolean): void {
        if (enabled && !this.supported()) return;
        if (enabled) { this.paused.set(false); void this.narrator.activate(); }
        this.update(current => ({ ...current, enabled }));
        if (!enabled) this.interrupt();
    }

    togglePause(): void {
        this.paused.update(value => !value);
        this.interrupt();
        if (!this.paused()) void this.narrator.activate();
    }

    setVoice(voice: string): void {
        if (!['browser', 'marin', 'cedar'].includes(voice)) return;
        if (voice !== 'browser' && !this.access.requestAction('ai')) return;
        this.interrupt();
        this.update(current => ({ ...current, voice: voice as LiveCoachVoice }));
        if (voice !== 'browser') void this.narrator.activate();
    }

    setEvent(kind: 'entries' | 'sizing' | 'exits' | 'guardrails', enabled: boolean): void {
        this.update(current => ({ ...current, [kind]: enabled }));
    }

    setAiCommentary(enabled: boolean): void {
        if (enabled && !this.access.requestAction('ai')) return;
        this.update(current => ({ ...current, aiCommentary: enabled }));
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
        if (this.previewing()) return;
        this.interrupt();
        const activated = this.narrator.activate();
        const owner = this.owner;
        const sequence = this.sequence;
        const voice = this.preferences().voice;
        this.previewing.set(true);
        this.voiceWarning.set(null);
        const controller = new AbortController();
        const generation = ++this.aiGeneration;
        this.aiController = controller;
        try {
            if (voice === 'browser') {
                await this.narrator.speak('Live Coach is ready. Position updates will be short and focused.', this.preferences().speechRate);
                return;
            }
            await activated;
            if (sequence !== this.sequence || controller.signal.aborted) return;
            const reply = await this.boundedReply(this.ai.previewLiveCoachVoice(voice, controller.signal), controller);
            if (sequence !== this.sequence || owner !== this.owner || controller.signal.aborted) return;
            if (!reply.audio) this.voiceWarning.set('AI voice is unavailable. Using the browser voice.');
            await this.playReply(reply);
        } catch {
            if (sequence !== this.sequence || generation !== this.aiGeneration || owner !== this.owner) return;
            this.voiceWarning.set('AI voice could not load. Check your connection or daily allowance. Using the browser voice.');
            await this.narrator.speak('Live Coach is ready. Position updates will be short and focused.', this.preferences().speechRate);
        } finally {
            if (sequence === this.sequence) { this.previewing.set(false); this.aiController = null; }
        }
    }

    private buffer(event: TradovateLivePositionEvent): void {
        if (this.previewing() || Date.now() < this.guardrailUntil) return;
        // Even a muted event can make an earlier observation stale (e.g. a close).
        this.cancelAi();
        this.narrator.stop();
        this.aiState.set(this.preferences().aiCommentary && this.aiAvailable() ? 'ready' : 'off');
        const sequence = ++this.sequence;
        if (!liveCoachEventEnabled(event.kind, this.preferences())) {
            this.clearPending();
            return;
        }
        const key = liveCoachEventBucket(event);
        const existing = this.pending.get(key);
        if (existing) clearTimeout(existing.timer);
        const events = [...(existing?.events ?? []), event];
        const timer = setTimeout(() => void this.flush(key), GROUP_WINDOW_MS);
        this.pending.set(key, { events, timer, sequence });
    }

    private async flush(key: string): Promise<void> {
        const bucket = this.pending.get(key);
        if (!bucket) return;
        this.pending.delete(key);
        const owner = this.owner;
        const preferences = this.preferences();
        if (!this.isCurrent(bucket.sequence) || !bucket.events.some(event => liveCoachEventEnabled(event.kind, preferences))) return;

        const contractName = await this.resolveContractName(bucket.events[0]);
        if (!owner || owner !== this.owner || owner !== this.session.userId() || !this.isCurrent(bucket.sequence)) return;
        const narration = buildLiveCoachNarration(bucket.events, contractName);
        if (!narration) return;
        if (!shouldPersonalizeLiveCoachEvent(narration.kind) && this.aiController) {
            this.cancelAi();
            this.aiState.set(this.preferences().aiCommentary && this.aiAvailable() ? 'ready' : 'off');
        }

        const now = Date.now();
        const previous = this.lastSpokenAt.get(narration.key) ?? 0;
        if (now - previous < this.preferences().cooldownSeconds * 1000) return;
        this.lastSpokenAt.set(narration.key, now);
        const finalNarration = await this.personalize(bucket.events, narration, contractName);
        if (!finalNarration || !owner || owner !== this.owner || owner !== this.session.userId()
            || !this.isCurrent(bucket.sequence) || !liveCoachEventEnabled(finalNarration.kind, this.preferences())) return;
        this.lastComment.set(finalNarration);
        this.recordComment(finalNarration.text, finalNarration.personalized);
        this.alerts.publish({
            tone: finalNarration.tone,
            title: finalNarration.title,
            text: finalNarration.text,
        });
        await this.playReply(finalNarration);
    }

    private async personalize(
        events: readonly TradovateLivePositionEvent[],
        narration: LiveCoachNarration,
        contractName: string | null,
    ): Promise<LiveCoachNarration | null> {
        const preferences = this.preferences();
        if (!preferences.aiCommentary || !this.aiAvailable()
            || !shouldPersonalizeLiveCoachEvent(narration.kind)) return narration;

        this.cancelAi();
        const generation = ++this.aiGeneration;
        const controller = new AbortController();
        this.aiController = controller;
        this.aiState.set('thinking');
        try {
            const owner = this.owner;
            if (!owner) return null;
            const payload = buildLiveCoachAiPayload(
                events,
                narration,
                this.trades.trades().filter(trade => trade.userId === owner),
                this.live.metrics(),
                contractName ?? 'Position',
            );
            const response = await this.boundedReply(this.ai.generateLiveCoachReply({
                ...payload, voice: preferences.voice,
            }, controller.signal), controller);
            if (generation !== this.aiGeneration || controller.signal.aborted
                || owner !== this.owner || owner !== this.session.userId()) return null;
            const text = normalizeLiveCoachAiText(response.text);
            if (!text) throw new Error('Empty Coach response.');
            this.aiState.set('ready');
            this.voiceWarning.set(preferences.voice !== 'browser' && !response.audio
                ? 'AI voice is unavailable. Using the browser voice.' : null);
            return { ...narration, text, personalized: true, audio: response.audio };
        } catch {
            if (generation !== this.aiGeneration || this.owner !== this.session.userId()) return null;
            this.aiState.set('fallback');
            return narration;
        } finally {
            if (generation === this.aiGeneration) this.aiController = null;
        }
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
        this.guardrailUntil = 0;
        this.recentComments.set([]);
        this.voiceWarning.set(null);
        this.paused.set(false);
        this.cancelAi();
        this.aiState.set('off');
        this.interrupt();
    }

    private isCurrent(sequence: number): boolean {
        return sequence === this.sequence && this.preferences().enabled && !this.paused()
            && this.access.canAct('sync') && this.liveState() === 'live' && Date.now() >= this.guardrailUntil;
    }

    private interrupt(): void {
        this.sequence++;
        this.guardrailUntil = 0;
        this.cancelAi();
        this.clearPending();
        this.previewing.set(false);
        this.narrator.stop();
    }

    private recordComment(text: string, personalized: boolean): void {
        this.lastSpokenText.set(text);
        this.recentComments.update(items => [{ text, time: Date.now(), personalized }, ...items].slice(0, 10));
    }

    private playReply(reply: LiveCoachReply): Promise<boolean> {
        return reply.audio
            ? this.narrator.speak(reply.text, this.preferences().speechRate, reply.audio)
            : this.narrator.speak(reply.text, this.preferences().speechRate);
    }

    private async boundedReply(request: Promise<LiveCoachReply>, controller: AbortController): Promise<LiveCoachReply> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let aborted: (() => void) | undefined;
        try {
            controller.signal.throwIfAborted();
            return await Promise.race([request, new Promise<never>((_, reject) => {
                aborted = () => reject(new Error('Coach request cancelled.'));
                controller.signal.addEventListener('abort', aborted, { once: true });
                timer = setTimeout(() => controller.abort(), AI_COMMENT_TIMEOUT_MS);
            })]);
        } finally {
            clearTimeout(timer);
            if (aborted) controller.signal.removeEventListener('abort', aborted);
        }
    }

    private clearPending(): void {
        for (const bucket of this.pending.values()) clearTimeout(bucket.timer);
        this.pending.clear();
        if (this.guardrailTimer) clearTimeout(this.guardrailTimer);
        this.guardrailTimer = null;
    }

    private cancelAi(): void {
        this.aiGeneration++;
        this.aiController?.abort();
        this.aiController = null;
    }
}
