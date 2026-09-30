import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiveCoachService } from './live-coach.service';
import { LIVE_COACH_AI_VOICE_OPTIONS } from './live-coach-voices';

/** Shared voice preferences for full settings and the compact floating coach. */
@Component({
    selector: 'app-live-coach-voice-select',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="coach-voice">
            <label class="coach-voice__toggle">
                <span>Voice playback<small>Audio for updates and Read summary.</small></span>
                <input type="checkbox" aria-label="Voice playback" [checked]="coach.preferences().voiceEnabled"
                       [disabled]="coach.preferencesLoading()" (change)="coach.setVoiceEnabled($any($event.target).checked)" />
            </label>
            @if (!coach.sounds.enabled()) {
                <p class="coach-voice__hint" role="status">Master sound is off. Enable it in the header or Sound settings to hear the Coach. Written updates continue when automatic coaching is on.</p>
            }
            <label class="coach-voice__selection">Coaching voice
                <select [disabled]="coach.preferencesLoading()" [value]="coach.aiAvailable() ? coach.preferences().voice : 'browser'"
                        (change)="coach.setVoice($any($event.target).value)">
                    <optgroup label="AI voices · Premium+" [disabled]="!coach.aiAvailable()">
                        @for (voice of voices; track voice.id) {
                            <option [value]="voice.id" [selected]="coach.aiAvailable() && coach.preferences().voice === voice.id">{{ voice.label }}</option>
                        }
                    </optgroup>
                    <option value="browser" [selected]="!coach.aiAvailable() || coach.preferences().voice === 'browser'">Browser voice</option>
                </select>
            </label>
        </div>
    `,
    styles: `
        .coach-voice { display: grid; gap: .75rem; min-width: 0; color: var(--color-text-primary); font-size: .8125rem;
            &__toggle { display: flex; align-items: center; gap: .75rem; min-height: 44px; cursor: pointer;
                span { flex: 1; min-width: 0; }
                small { display: block; margin-top: .25rem; color: var(--color-text-secondary); font-size: .75rem; line-height: 1.5; }
                input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--color-accent);
                    &:disabled { cursor: not-allowed; } }
                input:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; } }
            &__selection { display: grid; gap: .5rem; }
            &__hint { margin: 0; font-size: .75rem; line-height: 1.5; color: var(--color-text-secondary); }
        }
        select { width: 100%; min-width: 0; min-height: 44px; padding: .5rem .75rem; border-radius: 8px;
            border: 1px solid var(--color-border); background: var(--color-bg-surface-2);
            color: var(--color-text-primary); font: inherit; }
        select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
    `,
})
export class LiveCoachVoiceSelectComponent {
    readonly coach = inject(LiveCoachService);
    readonly voices = LIVE_COACH_AI_VOICE_OPTIONS;
}
