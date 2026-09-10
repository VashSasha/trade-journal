import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { LiveCoachAudio } from './live-coach.models';

export type LiveCoachNarratorState = 'idle' | 'speaking' | 'unsupported' | 'error';

/** Owns playback only. Voice providers can change without touching broker events. */
@Injectable({ providedIn: 'root' })
export class LiveCoachNarratorService {
    private readonly view = inject(DOCUMENT).defaultView;
    private readonly destroyRef = inject(DestroyRef);
    readonly supported = signal(!!this.view?.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');
    readonly state = signal<LiveCoachNarratorState>(this.supported() ? 'idle' : 'unsupported');
    readonly error = signal<string | null>(null);
    readonly audioReady = signal(false);
    readonly voiceFallback = signal(false);
    private context: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private finishActive: (() => void) | null = null;
    private generation = 0;

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.stop();
            if (this.context) {
                this.context.onstatechange = null;
                void this.context.close().catch(() => {});
            }
        });
    }

    /** Called during an Enable/Test/click gesture, before any network await. */
    async activate(): Promise<boolean> {
        if (typeof AudioContext === 'undefined') return false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
            this.context ??= new AudioContext({ latencyHint: 'interactive' });
            const context = this.context;
            context.onstatechange = () => this.audioReady.set(context.state === 'running');
            await Promise.race([
                context.state === 'running' ? Promise.resolve() : context.resume(),
                new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Audio blocked')), 2000); }),
            ]);
            this.audioReady.set(context.state === 'running');
            return this.audioReady();
        } catch { return false; }
        finally { clearTimeout(deadline); }
    }

    async speak(text: string, rate = 1, audio?: LiveCoachAudio): Promise<boolean> {
        this.stop();
        const generation = this.generation;
        const pace = Number.isFinite(rate) ? Math.max(0.8, Math.min(1.2, rate)) : 1;
        this.voiceFallback.set(false);
        if (audio) {
            try {
                const context = this.context;
                if (!context || context.state !== 'running') throw new Error('Audio needs activation');
                if (audio.mimeType !== 'audio/mpeg' || typeof audio.base64 !== 'string'
                    || !audio.base64.length || audio.base64.length > 512 * 1024
                    || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.base64)) throw new Error('Invalid voice audio');
                const binary = atob(audio.base64);
                const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
                let timer: ReturnType<typeof setTimeout> | undefined;
                const buffer = await Promise.race([
                    context.decodeAudioData(bytes.buffer),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Audio decode timed out')), 2000); }),
                ]).finally(() => clearTimeout(timer));
                if (generation !== this.generation) return false;
                if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 30) throw new Error('Invalid voice duration');
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = pace;
                source.connect(context.destination);
                this.source = source;
                const spoken = await this.play(done => {
                    source.onended = () => {
                        source.disconnect();
                        if (this.source === source) this.source = null;
                        done(true);
                    };
                    source.start();
                });
                if (generation !== this.generation) return false;
                if (spoken) return true;
                throw new Error('Audio playback failed');
            } catch {
                if (generation !== this.generation) return false;
                this.releaseSource();
                this.voiceFallback.set(true);
            }
        }
        const synthesis = this.view?.speechSynthesis;
        if (!this.supported() || !synthesis || !text.trim()) {
            this.state.set('unsupported');
            this.error.set('Voice narration is not supported in this browser.');
            return false;
        }
        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = pace;
        utterance.pitch = 1;
        utterance.volume = 1;
        return this.play(done => {
            utterance.onend = () => done(true);
            utterance.onerror = event => done(false, event.error === 'not-allowed'
                ? 'Your browser blocked speech. Use Test voice once to allow it.'
                : 'Voice narration is temporarily unavailable.');
            synthesis.speak(utterance);
        });
    }

    stop(): void {
        ++this.generation;
        this.finishActive?.();
        this.finishActive = null;
        this.releaseSource();
        this.view?.speechSynthesis?.cancel();
        if (this.supported()) this.state.set('idle');
    }

    private releaseSource(): void {
        if (this.source) {
            this.source.onended = null;
            try { this.source.stop(); } catch { /* Source may have already ended. */ }
            this.source.disconnect();
            this.source = null;
        }
    }

    private play(start: (done: (spoken: boolean, error?: string) => void) => void): Promise<boolean> {
        this.state.set('speaking');
        this.error.set(null);
        return new Promise(resolve => {
            let settled = false;
            const done = (spoken: boolean, message?: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(deadline);
                this.finishActive = null;
                this.state.set(message ? 'error' : 'idle');
                this.error.set(message ?? null);
                resolve(spoken);
            };
            const deadline = setTimeout(() => {
                this.stop();
                this.state.set('error');
                this.error.set('Voice narration timed out. Try Test voice again.');
            }, 30_000);
            this.finishActive = () => done(false);
            try { start(done); }
            catch { done(false, 'Voice narration is temporarily unavailable.'); }
        });
    }
}
