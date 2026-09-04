import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

@Component({
    selector: 'app-landing-ai',
    standalone: true,
    imports: [RevealOnScrollDirective, RouterLink],
    templateUrl: './landing-ai.component.html',
    styleUrl: './landing-ai.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingAiComponent {}
