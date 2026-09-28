import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-landing-ai',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './landing-ai.component.html',
    styleUrl: './landing-ai.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingAiComponent {}
