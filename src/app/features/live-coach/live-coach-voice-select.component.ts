import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiveCoachService } from './live-coach.service';
import { LIVE_COACH_AI_VOICE_OPTIONS } from './live-coach-voices';

/** Shared by full settings and the compact floating coach. */
@Component({
    selector: 'app-live-coach-voice-select',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <label class="coach-voice">Coaching voice
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
    `,
    styles: `
        .coach-voice { display: grid; gap: .5rem; color: var(--color-text-primary); font-size: .8125rem; }
        select { width: 100%; min-height: 44px; padding: .5rem .75rem; border-radius: 8px;
            border: 1px solid var(--color-border); background: var(--color-bg-surface-2);
            color: var(--color-text-primary); font: inherit; }
        select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
    `,
})
export class LiveCoachVoiceSelectComponent {
    readonly coach = inject(LiveCoachService);
    readonly voices = LIVE_COACH_AI_VOICE_OPTIONS;
}
