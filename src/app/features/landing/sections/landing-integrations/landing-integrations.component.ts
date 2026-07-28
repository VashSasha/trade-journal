import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

@Component({
    selector: 'app-landing-integrations',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-integrations.component.html',
    styleUrl: './landing-integrations.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingIntegrationsComponent {}
