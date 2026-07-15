import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';
import { LandingHeroComponent } from './sections/landing-hero/landing-hero.component';
import { LandingFeaturesComponent } from './sections/landing-features/landing-features.component';
import { LandingShowcaseComponent } from './sections/landing-showcase/landing-showcase.component';
import { LandingCtaComponent } from './sections/landing-cta/landing-cta.component';

@Component({
    selector: 'app-landing',
    standalone: true,
    imports: [
        RouterLink,
        LandingHeroComponent,
        LandingFeaturesComponent,
        LandingShowcaseComponent,
        LandingCtaComponent
    ],
    templateUrl: './landing.component.html',
    styleUrl: './landing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent {
    theme = inject(ThemeService);
}
