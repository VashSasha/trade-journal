import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicNavComponent } from '../../shared/components/public-nav/public-nav.component';
import { LandingHeroComponent } from './sections/landing-hero/landing-hero.component';
import { LandingFeaturesComponent } from './sections/landing-features/landing-features.component';
import { LandingShowcaseComponent } from './sections/landing-showcase/landing-showcase.component';
import { LandingPricingComponent } from './sections/landing-pricing/landing-pricing.component';
import { LandingCtaComponent } from './sections/landing-cta/landing-cta.component';

@Component({
    selector: 'app-landing',
    standalone: true,
    imports: [
        PublicNavComponent,
        LandingHeroComponent,
        LandingFeaturesComponent,
        LandingShowcaseComponent,
        LandingPricingComponent,
        LandingCtaComponent
    ],
    templateUrl: './landing.component.html',
    styleUrl: './landing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent {}
