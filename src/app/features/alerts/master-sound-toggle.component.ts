import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SessionAlertsService } from './session-alerts.service';

/** One master audio control, independent of individual alert/coach preferences. */
@Component({
    selector: 'app-master-sound-toggle',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-sound-controls': '' },
    template: `
            <button type="button" class="sound-toggle" [class.sound-toggle--muted]="!sounds.enabled()"
                [attr.aria-label]="sounds.toggleLabel()" [attr.aria-pressed]="sounds.enabled()"
                [title]="sounds.toggleLabel() + '. ' + sounds.status().detail"
                [disabled]="!sounds.supported || sounds.preferencesLoading()"
                (click)="sounds.toggle()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M4 9h4l5-4v14l-5-4H4z" />
                    @if (!sounds.enabled()) { <path d="m17 9 5 6m0-6-5 6" /> }
                    @else { <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /> }
                </svg>
            </button>
    `,
    styles: `
        :host { display: contents; }
        .sound-toggle {
            display: grid; place-items: center; width: 44px; height: 44px; padding: 10px;
            border: 1px solid var(--color-border); border-radius: 9px;
            background: var(--color-accent-subtle); color: var(--color-accent); cursor: pointer;
        }
        .sound-toggle--muted { background: var(--color-bg-surface-2); color: var(--color-text-muted); }
        .sound-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
        .sound-toggle svg { width: 20px; height: 20px; }
        .sound-toggle:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    `,
})
export class MasterSoundToggleComponent {
    readonly sounds = inject(SessionAlertsService);
}
