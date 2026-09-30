import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LiveCoachFollowUpAnswer } from './live-coach.models';

/** One text-only rendering for live and saved follow-up answers. */
@Component({
    selector: 'app-live-coach-answer',
    standalone: true,
    template: `@if (conversational()) {
        <div class="coach-answer coach-answer--chat">
            <p>{{ answer().meaning }}</p>
            <details><summary>More detail</summary><dl>
                <dt>Based on</dt><dd>{{ answer().evidence }}</dd>
                <dt>Next step</dt><dd>{{ answer().nextStep }}</dd>
            </dl></details>
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
            summary { cursor: pointer; min-height: 44px; width: fit-content; align-content: center; color: var(--color-text-secondary); font-size: .75rem;
                &:focus-visible { outline: 2px solid var(--color-accent); } }
            dl { margin: 0 0 .75rem; } }
    }`,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachAnswerComponent {
    readonly answer = input.required<LiveCoachFollowUpAnswer>();
    readonly conversational = input(false);
}
