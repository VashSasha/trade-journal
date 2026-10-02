import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';
import {
    CustomAlertSoundMetadata, customSoundFileError, customSoundMimeType, MAX_CUSTOM_SOUND_BYTES,
    MAX_CUSTOM_SOUND_SECONDS, safeCustomSoundName, StoredCustomAlertSound,
} from './custom-alert-sounds.models';
import { CustomAlertSoundsService } from './custom-alert-sounds.service';
import { AlertSoundKind } from './session-alerts.utils';
import { SessionSoundPreferencesService } from './session-sound-preferences.service';
import { alertSoundAssetPath, AlertSoundPresetId, AlertSoundSelection, isAlertSoundPreset, resolveSoundSelection } from './alert-sound-library';
import { SOUND_FALLBACKS } from './alert-sound-kinds';

/** Local audio engine: built-in synthesized cues plus private account-synced user files. */
@Injectable({ providedIn: 'root' })
export class AlertAudioService {
    private static readonly PARTIALS = [
        { ratio: 1, level: 0.56 },
        { ratio: 2.01, level: 0.2 },
        { ratio: 2.49, level: 0.12 },
        { ratio: 3.92, level: 0.075 },
        { ratio: 5.4, level: 0.045 },
    ] as const;
    private readonly library = inject(CustomAlertSoundsService);
    private readonly preferences = inject(SessionSoundPreferencesService).preferences;
    private readonly document = inject(DOCUMENT);
    readonly customSounds = this.library.sounds;
    readonly customSoundsLoading = this.library.loading;
    readonly customSoundsError = this.library.error;
    readonly customSoundStorageSupported = this.library.supported;
    readonly presetSoundsLoading = signal(false);
    readonly presetSoundsError = signal<string | null>(null);
    private context: AudioContext | null = null;
    private output: GainNode | null = null;
    private availableAt = 0;
    private customBuffers = new Map<AlertSoundKind, AudioBuffer>();
    private loadedRevision = -1;
    private customLoadGeneration = 0;
    private presetLoadGeneration = 0;
    private readonly presetBuffers = new Map<AlertSoundPresetId, AudioBuffer>();
    private readonly presetRequests = new Map<AlertSoundPresetId, Promise<void>>();
    private readonly presetControllers = new Set<AbortController>();

    constructor() {
        effect(() => {
            const revision = this.library.revision();
            const context = this.context;
            if (!context || context.state !== 'running' || revision === this.loadedRevision) return;
            void this.syncCustomSounds(context, revision);
        });
        effect(() => {
            const selections = this.preferences().selections;
            const context = this.context;
            if (context?.state === 'running') void this.syncPresetSounds(context, selections);
        });
    }

    supported(): boolean { return typeof AudioContext !== 'undefined'; }
    running(): boolean { return this.context?.state === 'running'; }

    /** Call only from an explicit Enable/Test gesture. Never unlock from a timer. */
    async activate(): Promise<void> {
        if (!this.supported()) throw new Error('Sound alerts are not supported in this browser.');
        if (!this.context || this.context.state === 'closed') {
            this.context = new AudioContext({ latencyHint: 'interactive' });
            this.output = this.context.createGain();
            this.output.connect(this.context.destination);
        }
        const context = this.context;
        // resume() is invoked before awaiting, while the gesture is still active.
        const resume = context.state === 'running' ? Promise.resolve() : context.resume();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([resume, new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Audio was blocked. Click Enable sounds or Test sound again.')), 3000);
            })]);
            if (context !== this.context || context.state !== 'running') throw new Error('Audio is paused. Enable sounds again.');
        } finally { clearTimeout(timeout); }
        await Promise.all([
            this.syncCustomSounds(context, this.library.revision()),
            this.syncPresetSounds(context, this.preferences().selections),
        ]);
    }

    setVolume(volume: number): void {
        if (this.output) this.output.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.3;
    }

    /** Returns audible duration in milliseconds, or 0 when another bell is ringing. */
    play(kind: AlertSoundKind, volume: number, previewSelection?: AlertSoundSelection): number {
        const context = this.context;
        if (!context || !this.output || context.state !== 'running') throw new Error('Audio is paused. Enable sounds again.');
        if (volume <= 0 || context.currentTime < this.availableAt) return 0;
        this.setVolume(volume);
        const resolved = resolveSoundSelection(kind, this.preferences().selections,
            key => this.customBuffers.has(key) || !!this.customSounds()[key], previewSelection);
        kind = resolved.kind;
        const selection = resolved.selection;
        if (selection === 'silent') return 0;
        const buffer = isAlertSoundPreset(selection) ? this.presetBuffers.get(selection)
            : selection === 'custom' ? this.customBuffers.get(kind) : undefined;
        if (buffer) return this.playCustom(context, buffer);
        kind = SOUND_FALLBACKS[kind] ?? kind;
        if (kind === 'positionOpened' || kind === 'positionIncreased') kind = 'open';
        else if (kind === 'positionReversed') kind = 'risk';
        else if (kind === 'positionClosed' || kind === 'positionReduced') kind = 'close';
        // Opening resembles a brisk exchange-floor bell; closing uses a slower,
        // descending double toll. Inharmonic partials create the metallic body.
        const strikes = kind === 'open'
            ? [{ offset: 0, frequency: 784 }, { offset: 0.28, frequency: 831 }, { offset: 0.56, frequency: 784 }]
            : kind === 'target'
                ? [{ offset: 0, frequency: 659.25 }, { offset: 0.2, frequency: 783.99 }, { offset: 0.4, frequency: 987.77 }]
                : kind === 'risk'
                    ? [{ offset: 0, frequency: 587.33 }, { offset: 0.22, frequency: 440 }, { offset: 0.44, frequency: 349.23 }]
                    : [{ offset: 0, frequency: 659.25 }, { offset: 0.48, frequency: 523.25 }];
        const ring = kind === 'open' || kind === 'target' ? 1.15 : 1.45;
        const duration = Math.ceil((strikes[strikes.length - 1].offset + ring + 0.14) * 1000);
        const start = context.currentTime + 0.01;
        strikes.forEach(strike => {
            AlertAudioService.PARTIALS.forEach((partial, index) => {
                const oscillator = context.createOscillator();
                const envelope = context.createGain();
                const at = start + strike.offset;
                const decay = ring * (1 - index * 0.08);
                oscillator.type = 'sine';
                oscillator.frequency.value = strike.frequency * partial.ratio;
                envelope.gain.setValueAtTime(0.0001, at);
                envelope.gain.exponentialRampToValueAtTime(partial.level, at + 0.008);
                envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
                oscillator.connect(envelope);
                envelope.connect(this.output!);
                oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
                oscillator.start(at);
                oscillator.stop(at + decay + 0.03);
            });
        });
        this.availableAt = start + duration / 1000;
        return duration;
    }

    async installCustomSound(kind: AlertSoundKind, file: File): Promise<CustomAlertSoundMetadata> {
        const validationError = customSoundFileError(file);
        if (validationError) throw new Error(validationError);
        if (!this.customSoundStorageSupported) throw new Error('Custom sound storage is unavailable in this browser.');
        const wasRunning = this.running();
        try {
            await this.activate();
            const bytes = await file.arrayBuffer();
            if (!bytes.byteLength || bytes.byteLength > MAX_CUSTOM_SOUND_BYTES) {
                throw new Error('Audio files must be non-empty and 3 MB or smaller.');
            }
            const context = this.context;
            if (!context || context.state !== 'running') throw new Error('Audio is paused. Enable sounds again.');
            const decoded = await this.decode(context, bytes);
            if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_CUSTOM_SOUND_SECONDS) {
                throw new Error(`Custom sounds must be ${MAX_CUSTOM_SOUND_SECONDS} seconds or shorter.`);
            }
            const metadata: CustomAlertSoundMetadata = {
                kind,
                name: safeCustomSoundName(file.name),
                mimeType: customSoundMimeType(file)!,
                size: file.size,
                duration: Math.round(decoded.duration * 100) / 100,
                updatedAt: new Date().toISOString(),
            };
            await this.library.save({ ...metadata, bytes });
            if (context === this.context) this.customBuffers.set(kind, decoded);
            this.loadedRevision = this.library.revision();
            return metadata;
        } catch (error) {
            // Uploading can unlock Web Audio. Do not leave that context running
            // after a failed upload unless alerts were already active.
            if (!wasRunning) this.stop();
            throw error;
        }
    }

    async removeCustomSound(kind: AlertSoundKind): Promise<void> {
        await this.library.remove(kind);
        this.customBuffers.delete(kind);
        this.loadedRevision = this.library.revision();
    }

    stop(): void {
        const context = this.context;
        this.context = null;
        this.output = null;
        this.availableAt = 0;
        this.customBuffers.clear();
        this.loadedRevision = -1;
        ++this.customLoadGeneration;
        ++this.presetLoadGeneration;
        this.presetControllers.forEach(controller => controller.abort());
        this.presetControllers.clear();
        this.presetRequests.clear();
        this.presetBuffers.clear();
        this.presetSoundsLoading.set(false);
        this.presetSoundsError.set(null);
        if (context && context.state !== 'closed') void context.close().catch(() => {});
    }

    private playCustom(context: AudioContext, buffer: AudioBuffer): number {
        const source = context.createBufferSource();
        const start = context.currentTime + 0.01;
        source.buffer = buffer;
        source.connect(this.output!);
        source.onended = () => source.disconnect();
        source.start(start);
        const duration = Math.ceil((buffer.duration + 0.08) * 1000);
        this.availableAt = start + duration / 1000;
        return duration;
    }

    private async syncPresetSounds(context: AudioContext, selections = this.preferences().selections): Promise<void> {
        const generation = ++this.presetLoadGeneration;
        const ids = [...new Set(Object.values(selections ?? {}).filter(isAlertSoundPreset))];
        this.presetSoundsLoading.set(ids.some(id => !this.presetBuffers.has(id)));
        this.presetSoundsError.set(null);
        const results = await Promise.allSettled(ids.map(id => this.loadPreset(context, id)));
        if (context !== this.context || generation !== this.presetLoadGeneration) return;
        this.presetSoundsLoading.set(false);
        if (results.some(result => result.status === 'rejected')) {
            this.presetSoundsError.set('A library sound could not load. The default bell will play instead. Preview to retry.');
        }
    }

    /** Preview a catalog entry without persisting it or downloading the rest. */
    async prepareSound(selection: AlertSoundSelection): Promise<void> {
        if (!isAlertSoundPreset(selection)) return;
        const context = this.context;
        if (!context || context.state !== 'running') throw new Error('Enable sounds before previewing.');
        try { await this.loadPreset(context, selection); }
        catch { throw new Error('This sound could not load. Check your connection and preview again.'); }
    }

    private loadPreset(context: AudioContext, id: AlertSoundPresetId): Promise<void> {
        if (this.presetBuffers.has(id)) return Promise.resolve();
        const pending = this.presetRequests.get(id);
        if (pending) return pending;
        const controller = new AbortController();
        this.presetControllers.add(controller);
        const request = (async () => {
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
                const response = await fetch(new URL(alertSoundAssetPath(id), this.document.baseURI), {
                    signal: controller.signal, credentials: 'omit',
                });
                if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
                    throw new Error('Library sound unavailable');
                }
                const bytes = await response.arrayBuffer();
                if (!bytes.byteLength || bytes.byteLength > MAX_CUSTOM_SOUND_BYTES) throw new Error('Invalid sound size');
                const buffer = await this.decode(context, bytes);
                if (buffer.duration <= 0 || buffer.duration > MAX_CUSTOM_SOUND_SECONDS) throw new Error('Invalid sound duration');
                if (context === this.context && !controller.signal.aborted) this.presetBuffers.set(id, buffer);
            } finally {
                clearTimeout(timeout);
                this.presetControllers.delete(controller);
            }
        })();
        this.presetRequests.set(id, request);
        void request.finally(() => {
            if (this.presetRequests.get(id) === request) this.presetRequests.delete(id);
        }).catch(() => {});
        return request;
    }

    private async syncCustomSounds(context: AudioContext, revision: number): Promise<void> {
        if (revision === this.loadedRevision) return;
        const generation = ++this.customLoadGeneration;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let records: StoredCustomAlertSound[];
        try {
            records = await Promise.race([
                this.library.currentRecords(),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Custom sound storage timed out.')), 2000);
                }),
            ]);
        } catch {
            return;
        } finally {
            clearTimeout(timeout);
        }
        const decoded = new Map<AlertSoundKind, AudioBuffer>();
        await Promise.all(records.map(async record => {
            try {
                const buffer = await this.decode(context, record.bytes);
                if (buffer.duration > 0 && buffer.duration <= MAX_CUSTOM_SOUND_SECONDS) decoded.set(record.kind, buffer);
            } catch { /* A damaged cached file falls back to the built-in cue. */ }
        }));
        if (context !== this.context || generation !== this.customLoadGeneration) return;
        this.customBuffers = decoded;
        this.loadedRevision = revision;
    }

    private async decode(context: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                context.decodeAudioData(bytes.slice(0)),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('The audio file took too long to decode.')), 5000);
                }),
            ]);
        } catch (error) {
            if (error instanceof Error && error.message.includes('too long')) throw error;
            throw new Error('This audio file could not be decoded. Try MP3, WAV, OGG, WebM, M4A, or AAC.');
        } finally {
            clearTimeout(timeout);
        }
    }
}
