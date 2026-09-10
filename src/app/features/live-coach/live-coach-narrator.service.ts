import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export type LiveCoachNarratorState = 'idle' | 'speaking' | 'unsupported' | 'error';

/**
 * On-device narration boundary. A hosted neural voice can replace this service
 * later without changing realtime position processing or coaching rules.
 */
@Injectable({ providedIn: 'root' })
export class LiveCoachNarratorService {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    readonly supported = signal(!!this.view?.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');
    readonly state = signal<LiveCoachNarratorState>(this.supported() ? 'idle' : 'unsupported');
    readonly error = signal<string | null>(null);
    private generation = 0;

    constructor() {
        this.destroyRef.onDestroy(() => this.stop());
    }

    speak(text: string, rate = 1): Promise<boolean> {
        const synthesis = this.view?.speechSynthesis;
        if (!this.supported() || !synthesis || !text.trim()) {
            this.state.set('unsupported');
            this.error.set('Voice narration is not supported in this browser.');
            return Promise.resolve(false);
        }

        const generation = ++this.generation;
        synthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = Math.max(0.8, Math.min(1.2, rate));
        utterance.pitch = 1;
        utterance.volume = 1;
        this.state.set('speaking');
        this.error.set(null);

        return new Promise(resolve => {
            let settled = false;
            const finish = (spoken: boolean, message?: string) => {
                if (settled) return;
                settled = true;
                if (generation === this.generation) {
                    this.state.set(message ? 'error' : 'idle');
                    this.error.set(message ?? null);
                }
                resolve(spoken);
            };
            const timeout = this.view!.setTimeout(
                () => {
                    finish(false, 'Voice narration timed out. Try the test voice again.');
                    synthesis.cancel();
                },
                15_000,
            );
            utterance.onend = () => {
                this.view!.clearTimeout(timeout);
                finish(true);
            };
            utterance.onerror = event => {
                this.view!.clearTimeout(timeout);
                const blocked = event.error === 'not-allowed';
                finish(false, blocked
                    ? 'Your browser blocked speech. Use Test voice once to allow it.'
                    : 'Voice narration is temporarily unavailable.');
            };
            try {
                synthesis.speak(utterance);
            } catch {
                this.view!.clearTimeout(timeout);
                finish(false, 'Voice narration is temporarily unavailable.');
            }
        });
    }

    stop(): void {
        ++this.generation;
        this.view?.speechSynthesis?.cancel();
        if (this.supported()) this.state.set('idle');
    }
}
