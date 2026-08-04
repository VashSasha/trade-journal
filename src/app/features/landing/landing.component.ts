import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicNavComponent } from '../../shared/components/public-nav/public-nav.component';
import { LandingHeroComponent } from './sections/landing-hero/landing-hero.component';
import { LandingAiComponent } from './sections/landing-ai/landing-ai.component';
import { LandingIntegrationsComponent } from './sections/landing-integrations/landing-integrations.component';
import { LandingFeaturesComponent } from './sections/landing-features/landing-features.component';
import { LandingAudienceComponent } from './sections/landing-audience/landing-audience.component';
import { LandingDiscordComponent } from './sections/landing-discord/landing-discord.component';
// LandingTestimonialsComponent intentionally not imported — see landing.component.html.
import { LandingComparisonComponent } from './sections/landing-comparison/landing-comparison.component';
import { LandingPricingComponent } from './sections/landing-pricing/landing-pricing.component';
import { LandingFaqComponent } from './sections/landing-faq/landing-faq.component';
import { LandingCtaComponent } from './sections/landing-cta/landing-cta.component';

@Component({
    selector: 'app-landing',
    standalone: true,
    imports: [
        PublicNavComponent,
        LandingHeroComponent,
        LandingAiComponent,
        LandingIntegrationsComponent,
        LandingFeaturesComponent,
        LandingAudienceComponent,
        LandingDiscordComponent,
        LandingComparisonComponent,
        LandingPricingComponent,
        LandingFaqComponent,
        LandingCtaComponent
    ],
    templateUrl: './landing.component.html',
    styleUrl: './landing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent {}
