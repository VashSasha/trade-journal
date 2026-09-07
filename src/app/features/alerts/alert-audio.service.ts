import { effect, inject, Injectable } from '@angular/core';
import {
    CustomAlertSoundMetadata, customSoundFileError, customSoundMimeType, MAX_CUSTOM_SOUND_BYTES,
    MAX_CUSTOM_SOUND_SECONDS, safeCustomSoundName, StoredCustomAlertSound,
} from './custom-alert-sounds.models';
import { CustomAlertSoundsService } from './custom-alert-sounds.service';
import { AlertSoundKind } from './session-alerts.utils';

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
    readonly customSounds = this.library.sounds;
    readonly customSoundsLoading = this.library.loading;
    readonly customSoundsError = this.library.error;
    readonly customSoundStorageSupported = this.library.supported;
    private context: AudioContext | null = null;
    private output: GainNode | null = null;
    private availableAt = 0;
    private customBuffers = new Map<AlertSoundKind, AudioBuffer>();
    private loadedRevision = -1;
    private customLoadGeneration = 0;

    constructor() {
        effect(() => {
            const revision = this.library.revision();
            const context = this.context;
            if (!context || context.state !== 'running' || revision === this.loadedRevision) return;
            void this.syncCustomSounds(context, revision);
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
        await this.syncCustomSounds(context, this.library.revision());
    }

    setVolume(volume: number): void {
        if (this.output) this.output.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.3;
    }

    /** Returns audible duration in milliseconds, or 0 when another bell is ringing. */
    play(kind: AlertSoundKind, volume: number): number {
        const context = this.context;
        if (!context || !this.output || context.state !== 'running') throw new Error('Audio is paused. Enable sounds again.');
        if (volume <= 0 || context.currentTime < this.availableAt) return 0;
        this.setVolume(volume);
        const custom = this.customBuffers.get(kind);
        if (custom) return this.playCustom(context, custom);
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
