import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

@Component({
    selector: 'app-landing-cta',
    standalone: true,
    imports: [RouterLink, RevealOnScrollDirective],
    templateUrl: './landing-cta.component.html',
    styleUrl: './landing-cta.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingCtaComponent {
    readonly year = new Date().getFullYear();
}
