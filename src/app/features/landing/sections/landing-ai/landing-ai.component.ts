import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

@Component({
    selector: 'app-landing-ai',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-ai.component.html',
    styleUrl: './landing-ai.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingAiComponent {}
