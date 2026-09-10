import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiveCoachService } from './live-coach.service';

/** Compact playback control available from any authenticated page. */
@Component({
    selector: 'app-live-coach-toggle',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (coach.preferences().enabled) {
            <button type="button" class="coach-toggle" [class.coach-toggle--paused]="coach.paused()"
                [attr.aria-label]="coach.paused() ? 'Resume voice coach' : 'Pause voice coach'"
                [attr.aria-pressed]="!coach.paused()"
                [title]="coach.paused() ? 'Resume voice coach' : 'Pause voice coach'"
                (click)="coach.togglePause()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M4 9h4l5-4v14l-5-4H4z" />
                    @if (coach.paused()) { <path d="m17 9 5 6m0-6-5 6" /> }
                    @else { <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /> }
                </svg>
            </button>
        }
    `,
    styles: `
        :host { display: contents; }
        .coach-toggle {
            display: grid; place-items: center; width: 44px; height: 44px; padding: 10px;
            border: 1px solid var(--color-border); border-radius: 9px;
            background: var(--color-accent-subtle); color: var(--color-accent); cursor: pointer;
        }
        .coach-toggle--paused { background: var(--color-bg-surface-2); color: var(--color-text-muted); }
        .coach-toggle svg { width: 20px; height: 20px; }
        .coach-toggle:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    `,
})
export class LiveCoachToggleComponent {
    readonly coach = inject(LiveCoachService);
}
