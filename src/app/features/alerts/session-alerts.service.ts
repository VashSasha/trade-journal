import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { getSessionsSnapshot } from '../sessions/sessions.utils';
import { SessionsSnapshot } from '../sessions/sessions.model';
import { AlertAudioService } from './alert-audio.service';
import { SessionSoundPreferencesService } from './session-sound-preferences.service';
import { AlertSoundKind, crossedSessionAlerts, SessionAlertKind } from './session-alerts.utils';

const OWNER_LOCK = 'nvzn_session_sound_owner_v1';

/** One coordinator per app, shared by independently renderable controls/widgets. */
@Injectable({ providedIn: 'root' })
export class SessionAlertsService {
    private readonly document = inject(DOCUMENT);
    private readonly audio = inject(AlertAudioService);
    private readonly preferenceStore = inject(SessionSoundPreferencesService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    readonly preferences = this.preferenceStore.preferences;
    readonly preferencesLoading = this.preferenceStore.loading;
    readonly storageWarning = this.preferenceStore.storageWarning;
    readonly syncWarning = this.preferenceStore.syncWarning;
    readonly state = signal<'off' | 'enabling' | 'on'>('off');
    readonly enabled = computed(() => this.state() === 'on');
    readonly waitingForGesture = computed(() => this.state() === 'off' && this.preferences().armed);
    readonly previewing = signal(false);
    readonly error = signal<string | null>(null);
    readonly lastAlert = signal<string | null>(null);
    readonly supported = this.audio.supported() && !!this.view?.navigator.locks;
    private generation = 0;
    private hosts = 0;
    private releaseLease: (() => void) | null = null;
    private timer: number | undefined;
    private previewTimer: number | undefined;
    private previous: SessionsSnapshot | null = null;
    private highWater = 0;
    private restoreGesture: (() => void) | null = null;
    private observedOwner = this.preferenceStore.owner();
    private observedPreferences = this.preferences();

    constructor() {
        // A background tab may not receive its regular timer tick. Process a
        // recent boundary when it becomes visible instead of rebasing past it.
        const wake = () => { if (!this.document.hidden) this.tick(); };
        const pageExit = () => this.stopRuntime();
        this.document.addEventListener('visibilitychange', wake);
        this.view?.addEventListener('focus', wake);
        this.view?.addEventListener('pagehide', pageExit);
        this.destroyRef.onDestroy(() => {
            this.stopRuntime(false);
            this.disarmRestoreGesture();
            this.document.removeEventListener('visibilitychange', wake);
            this.view?.removeEventListener('focus', wake);
            this.view?.removeEventListener('pagehide', pageExit);
        });
        effect(() => {
            const owner = this.preferenceStore.owner();
            const preferences = this.preferences();
            const ownerChanged = owner !== this.observedOwner;
            const kindsChanged = preferences.opens !== this.observedPreferences.opens
                || preferences.closes !== this.observedPreferences.closes;
            this.observedOwner = owner;
            this.observedPreferences = preferences;
            this.audio.setVolume(preferences.volume);
            if (ownerChanged) this.stopRuntime(false);
            if (!preferences.armed) {
                this.disarmRestoreGesture();
                if (this.state() !== 'off') this.stopRuntime(false);
            } else if (!this.enabled()) {
                this.armRestoreGesture();
            } else if (kindsChanged) {
                this.rebase();
            }
        });
        if (this.preferences().armed) this.armRestoreGesture();
    }

    /** Stop on logout/navigation out of the app, or when the last widget is removed. */
    attach(host: DestroyRef): void {
        this.hosts++;
        host.onDestroy(() => { if (--this.hosts === 0) this.stopRuntime(); });
    }

    async enable(): Promise<void> {
        if (this.state() !== 'off' || this.previewing()) return;
        this.error.set(null);
        if (!this.supported) { this.error.set('Sound alerts need a supported browser on HTTPS or localhost.'); return; }
        if (!this.preferences().volume) { this.error.set('Increase the volume before enabling sounds.'); return; }
        const generation = ++this.generation;
        this.disarmRestoreGesture();
        this.state.set('enabling');
        try {
            await this.audio.activate();
            if (generation !== this.generation) return;
            if (!await this.acquireLease(generation)) throw new Error('Sounds are enabled in another NVZN tab. Mute them there first.');
            if (generation !== this.generation) return;
            this.previous = getSessionsSnapshot(Date.now());
            this.highWater = this.previous.now;
            this.state.set('on');
            this.preferenceStore.update(p => ({ ...p, armed: true }));
            this.timer = this.view!.setInterval(() => this.tick(), 10_000);
        } catch (error) {
            if (generation !== this.generation) return;
            this.stopRuntime();
            this.error.set(error instanceof Error ? error.message : 'Could not enable sounds. Try again.');
        }
    }

    /** Explicit user opt-out. Runtime shutdowns preserve their opt-in intent. */
    mute(): void {
        this.preferenceStore.update(p => ({ ...p, armed: false }));
        this.error.set(null);
        this.stopRuntime(false);
    }

    private stopRuntime(rearm = true): void {
        ++this.generation;
        this.state.set('off');
        this.previewing.set(false);
        this.view?.clearInterval(this.timer);
        this.view?.clearTimeout(this.previewTimer);
        this.timer = this.previewTimer = undefined;
        this.previous = null;
        this.releaseLease?.();
        this.releaseLease = null;
        this.audio.stop();
        if (rearm && this.preferences().armed) this.armRestoreGesture();
    }

    async preview(kind: AlertSoundKind): Promise<void> {
        if (this.previewing() || this.state() === 'enabling' || !this.preferences().volume) return;
        this.previewing.set(true);
        this.error.set(null);
        const generation = this.generation;
        try {
            await this.audio.activate();
            if (generation !== this.generation) return;
            const duration = this.audio.play(kind, this.preferences().volume);
            this.previewTimer = this.view!.setTimeout(() => {
                this.previewing.set(false);
                if (!this.enabled()) this.audio.stop();
            }, Math.max(600, duration + 100));
        } catch (error) {
            if (generation !== this.generation) return;
            this.stopRuntime();
            this.error.set(error instanceof Error ? error.message : 'Could not play the test sound.');
        }
    }

    /** Play a semantic cue when audio is active; visual alerts do not depend on it. */
    announce(kind: AlertSoundKind, text: string): void {
        if (!this.enabled() || this.previewing()) return;
        try {
            if (!this.audio.running()) throw new Error('Your browser paused audio. Enable sounds again.');
            if (this.audio.play(kind, this.preferences().volume)) this.lastAlert.set(text);
        } catch (error) {
            this.stopRuntime();
            this.error.set(error instanceof Error ? error.message : 'Sound is unavailable. Enable it again.');
        }
    }

    setVolume(value: number): void {
        if (!Number.isFinite(value)) return;
        const volume = Math.round(Math.max(0, Math.min(100, value)));
        this.preferenceStore.update(p => ({ ...p, volume, armed: volume > 0 && p.armed }), false);
        this.audio.setVolume(volume);
        if (!volume) this.stopRuntime(false);
    }

    setKind(kind: SessionAlertKind, enabled: boolean): void {
        this.preferenceStore.update(p => ({ ...p, [kind === 'open' ? 'opens' : 'closes']: enabled }));
        this.rebase();
    }

    private tick(): void {
        if (!this.enabled() || !this.previous) return;
        try {
            if (!this.audio.running()) throw new Error('Your browser paused audio. Enable sounds again.');
            const now = Date.now();
            const events = crossedSessionAlerts(this.previous, now).filter(event =>
                event.at > this.highWater && (event.kind === 'open' ? this.preferences().opens : this.preferences().closes));
            this.previous = getSessionsSnapshot(now);
            this.highWater = Math.max(this.highWater, now);
            if (!events.length || this.previewing()) return;
            // Coalesce simultaneous boundaries into one chime; never queue audio.
            if (this.audio.play(events[events.length - 1].kind, this.preferences().volume)) {
                this.lastAlert.set(events.map(event => event.text).join(' '));
            }
        } catch (error) {
            this.stopRuntime();
            this.error.set(error instanceof Error ? error.message : 'Session alerts are unavailable. Enable sounds again.');
        }
    }

    private rebase(): void {
        if (!this.enabled()) return;
        try {
            this.previous = getSessionsSnapshot(Date.now());
            this.highWater = Math.max(this.highWater, this.previous.now);
        } catch { this.stopRuntime(); this.error.set('Session times are unavailable. Check your device clock.'); }
    }

    private acquireLease(generation: number): Promise<boolean> {
        return new Promise(resolve => {
            void this.view!.navigator.locks.request(OWNER_LOCK, { ifAvailable: true }, async lock => {
                if (!lock || generation !== this.generation) { resolve(false); return; }
                await new Promise<void>(release => { this.releaseLease = release; resolve(true); });
            }).catch(() => resolve(false));
        });
    }

    /** Browsers allow Web Audio after a click/key press, so re-arm on that gesture. */
    private armRestoreGesture(): void {
        if (this.restoreGesture || !this.supported || !this.preferences().armed) return;
        const restore = () => {
            this.disarmRestoreGesture();
            if (this.preferences().armed && !this.enabled()) void this.enable();
        };
        this.restoreGesture = restore;
        this.document.addEventListener('pointerdown', restore, true);
        this.document.addEventListener('keydown', restore, true);
    }

    private disarmRestoreGesture(): void {
        if (!this.restoreGesture) return;
        this.document.removeEventListener('pointerdown', this.restoreGesture, true);
        this.document.removeEventListener('keydown', this.restoreGesture, true);
        this.restoreGesture = null;
    }

}
