import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';

/** Keep our help icon/theme; delegate positioning and interactions to Material. */
@Component({
    selector: 'app-help-tip',
    standalone: true,
    imports: [MatTooltip],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button type="button" class="help-tip__trigger" [attr.aria-label]="label()"
            #tip="matTooltip" [matTooltip]="text()" matTooltipClass="nvzn-help-tooltip"
            [matTooltipShowDelay]="100" [matTooltipHideDelay]="100" (click)="tip.show(0)">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="10" cy="10" r="7.25"/><path d="M10 9v5m0-8v1"/>
            </svg>
        </button>
    `,
    styles: `
        :host { display: inline-flex; flex: 0 0 auto; vertical-align: middle; }
        .help-tip__trigger {
            display: grid; place-items: center; width: 32px; height: 32px; padding: 7px;
            border: 0; border-radius: 50%; background: transparent; color: var(--color-text-muted); cursor: pointer;
        }
        .help-tip__trigger svg { width: 18px; height: 18px; }
        .help-tip__trigger:hover { background: var(--color-accent-subtle); color: var(--color-text-accent); }
        .help-tip__trigger:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
        @media (pointer: coarse) { .help-tip__trigger { width: 44px; height: 44px; } }
    `,
})
export class HelpTipComponent {
    readonly label = input('More information');
    readonly text = input.required<string>();
}
