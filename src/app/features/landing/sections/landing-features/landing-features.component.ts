import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

@Component({
    selector: 'app-landing-features',
    standalone: true,
    imports: [RevealOnScrollDirective, RouterLink],
    templateUrl: './landing-features.component.html',
    styleUrl: './landing-features.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFeaturesComponent {}
