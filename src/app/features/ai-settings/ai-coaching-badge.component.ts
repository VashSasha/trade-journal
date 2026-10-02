import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiCoachingSettingsService } from './ai-coaching-settings.service';

/** A current-mode indicator, not a claim about the tone of previously saved answers. */
@Component({
    selector: 'app-ai-coaching-badge', standalone: true, imports: [RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `@if (settings.active()) {
        <a class="ai-mode-badge" routerLink="/account/ai" title="Unhinged tone for new AI responses. Change it in AI settings.">
            <span aria-hidden="true">😈</span> Unhinged mode
        </a>
    }`,
    styles: `:host { display: contents; }
        .ai-mode-badge { display: inline-flex; align-items: center; gap: .375rem; width: fit-content; max-width: 100%;
            min-height: 32px; margin-block: .25rem; padding: .25rem .625rem; border-radius: 8px;
            border: 1px solid color-mix(in srgb, var(--color-negative) 65%, var(--color-border));
            background: color-mix(in srgb, var(--color-negative) 10%, var(--color-bg-surface));
            box-shadow: 0 0 14px color-mix(in srgb, var(--color-negative) 15%, transparent);
            color: var(--color-text-primary); font-size: .6875rem; font-weight: 650; text-decoration: none;
        }
        a:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
        @media (pointer: coarse) { .ai-mode-badge { min-height: 44px; } }`,
})
export class AiCoachingBadgeComponent implements OnInit {
    readonly settings = inject(AiCoachingSettingsService);
    ngOnInit(): void { void this.settings.load(); }
}
