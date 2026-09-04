import { Injectable } from '@angular/core';
import { SessionAlertKind } from './session-alerts.utils';

/** Local synthesized chimes: no media downloads, microphone, or third-party calls. */
@Injectable({ providedIn: 'root' })
export class AlertAudioService {
    private static readonly PARTIALS = [
        { ratio: 1, level: 0.56 },
        { ratio: 2.01, level: 0.2 },
        { ratio: 2.49, level: 0.12 },
        { ratio: 3.92, level: 0.075 },
        { ratio: 5.4, level: 0.045 },
    ] as const;
    private context: AudioContext | null = null;
    private output: GainNode | null = null;
    private availableAt = 0;

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
    }

    setVolume(volume: number): void {
        if (this.output) this.output.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.3;
    }

    /** Returns audible duration in milliseconds, or 0 when another bell is ringing. */
    play(kind: SessionAlertKind, volume: number): number {
        const context = this.context;
        if (!context || !this.output || context.state !== 'running') throw new Error('Audio is paused. Enable sounds again.');
        if (volume <= 0 || context.currentTime < this.availableAt) return 0;
        this.setVolume(volume);
        // Opening resembles a brisk exchange-floor bell; closing uses a slower,
        // descending double toll. Inharmonic partials create the metallic body.
        const strikes = kind === 'open'
            ? [{ offset: 0, frequency: 784 }, { offset: 0.28, frequency: 831 }, { offset: 0.56, frequency: 784 }]
            : [{ offset: 0, frequency: 659.25 }, { offset: 0.48, frequency: 523.25 }];
        const ring = kind === 'open' ? 1.15 : 1.45;
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

    stop(): void {
        const context = this.context;
        this.context = null;
        this.output = null;
        this.availableAt = 0;
        if (context && context.state !== 'closed') void context.close().catch(() => {});
    }
}
