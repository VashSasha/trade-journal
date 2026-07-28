import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

/**
 * PLACEHOLDER CONTENT — every quote below must be replaced with a real,
 * attributed NVZN member quote before deploy. Never ship invented praise.
 */
interface Testimonial {
    quote: string;
    name: string;
    role: string;
}

@Component({
    selector: 'app-landing-testimonials',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-testimonials.component.html',
    styleUrl: './landing-testimonials.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingTestimonialsComponent {
    readonly testimonials: Testimonial[] = [
        {
            quote: '[Beta tester quote here — replace before deploy]',
            name: '[Name]',
            role: 'NVZN member'
        },
        {
            quote: '[Beta tester quote here — replace before deploy]',
            name: '[Name]',
            role: 'NVZN member'
        },
        {
            quote: '[Beta tester quote here — replace before deploy]',
            name: '[Name]',
            role: 'NVZN member'
        }
    ];
}
