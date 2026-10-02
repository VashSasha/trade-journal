import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveCoachControlsComponent } from '../live-coach/live-coach-controls.component';
import { CoachingToneComponent } from './coaching-tone.component';

@Component({
    selector: 'app-ai-settings', standalone: true, imports: [RouterLink, LiveCoachControlsComponent, CoachingToneComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<section class="ai-settings">
        <header><h2>AI & coaching</h2><p>Choose how your coach talks to you, when it speaks, and what it notices.</p></header>
        <app-coaching-tone />
        <app-live-coach-controls />
        <p class="ai-settings__link">Session bells, master sound, custom sounds and risk limits remain in <a routerLink="/account/alerts">Alerts</a>.</p>
    </section>`,
    styles: `.ai-settings { display: grid; gap: 18px; min-width: 0; color: var(--color-text-primary); }
        h2 { margin: 0 0 5px; font-size: 1.25rem; }
        p { margin: 0; max-width: 72ch; color: var(--color-text-secondary); font-size: .875rem; line-height: 1.6; }
        a { color: var(--color-text-accent); } a:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }`,
})
export class AiSettingsComponent {}
