import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { LiveCoachFollowUpAnswer } from './live-coach.models';

let nextAnswerId = 0;

/** One text-only rendering for live and saved follow-up answers. */
@Component({
    selector: 'app-live-coach-answer',
    standalone: true,
    template: `@if (conversational()) {
        <div class="coach-answer coach-answer--chat">
            <p>{{ answer().meaning }}</p>
            <div class="coach-answer__actions" role="group" aria-label="Answer actions">
                <button type="button" [attr.aria-expanded]="detailsOpen()" [attr.aria-controls]="detailsId" (click)="detailsOpen.update(toggle)">
                    More details
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" [class.is-expanded]="detailsOpen()"><path d="m4 6 4 4 4-4"/></svg>
                </button>
                <ng-content select="[coachAnswerAction]" />
                @if (hasContext()) {
                    <button type="button" [attr.aria-expanded]="contextOpen()" [attr.aria-controls]="contextId" (click)="contextOpen.update(toggle)">
                        Context
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" [class.is-expanded]="contextOpen()"><path d="m4 6 4 4 4-4"/></svg>
                    </button>
                }
            </div>
            <dl [id]="detailsId" [hidden]="!detailsOpen()">
                <dt>Based on</dt><dd>{{ answer().evidence }}</dd>
                <dt>Next step</dt><dd>{{ answer().nextStep }}</dd>
            </dl>
            <div [id]="contextId" [hidden]="!hasContext() || !contextOpen()"><ng-content select="[coachAnswerContext]" /></div>
        </div>
    } @else {
        <dl class="coach-answer">
            <dt>What it means</dt><dd>{{ answer().meaning }}</dd>
            <dt>Evidence</dt><dd>{{ answer().evidence }}</dd>
            <dt>Review next</dt><dd>{{ answer().nextStep }}</dd>
        </dl>
    }`,
    styles: `.coach-answer { margin: .75rem 0; font-size: .8125rem; line-height: 1.6; overflow-wrap: anywhere;
        dt { margin-top: .75rem; font-weight: 600; color: var(--color-text-primary); }
        dd { margin: .25rem 0 0; color: var(--color-text-secondary); }
        &--chat { margin: 0; p { font-size: .875rem; line-height: 1.7; margin: 0; }
            dl { margin: 0 0 .75rem; } }
        &__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0 .25rem; margin-top: .25rem;
            button { display: inline-flex; align-items: center; gap: .25rem; min-height: 44px; padding: .375rem .5rem;
                border: 0; border-radius: 8px; background: transparent; color: var(--color-text-secondary); font: inherit; font-size: .75rem;
                line-height: 1.4; white-space: nowrap; cursor: pointer;
                &:hover { background: var(--color-bg-surface-2); color: var(--color-text-primary); }
                &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
                &[aria-expanded="true"] { color: var(--color-text-primary); } }
            svg { width: 12px; height: 12px; flex-shrink: 0; &.is-expanded { transform: rotate(180deg); } }
        }
    }`,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachAnswerComponent {
    readonly answer = input.required<LiveCoachFollowUpAnswer>();
    readonly conversational = input(false);
    readonly hasContext = input(false);
    readonly detailsOpen = signal(false);
    readonly contextOpen = signal(false);
    readonly detailsId = `coach-answer-${++nextAnswerId}-details`;
    readonly contextId = `${this.detailsId}-context`;
    readonly toggle = (open: boolean): boolean => !open;
}
