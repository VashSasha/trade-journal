import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PublicNavComponent } from '../../shared/components/public-nav/public-nav.component';
import { LandingHeroComponent } from './sections/landing-hero/landing-hero.component';
import { LandingAiComponent } from './sections/landing-ai/landing-ai.component';
import { LandingIntegrationsComponent } from './sections/landing-integrations/landing-integrations.component';
import { LandingFeaturesComponent } from './sections/landing-features/landing-features.component';
import { LandingDiscordComponent } from './sections/landing-discord/landing-discord.component';
// LandingTestimonialsComponent intentionally not imported — see landing.component.html.
import { LandingPricingComponent } from './sections/landing-pricing/landing-pricing.component';
import { LandingFaqComponent } from './sections/landing-faq/landing-faq.component';
import { LandingCtaComponent } from './sections/landing-cta/landing-cta.component';
import { LoginDialogComponent } from '../auth/login-dialog/login-dialog.component';
import { LoginDialogService } from '../auth/login-dialog/login-dialog.service';

@Component({
    selector: 'app-landing',
    standalone: true,
    imports: [
        PublicNavComponent,
        LandingHeroComponent,
        LandingAiComponent,
        LandingIntegrationsComponent,
        LandingFeaturesComponent,
        LandingDiscordComponent,
        LandingPricingComponent,
        LandingFaqComponent,
        LandingCtaComponent,
        LoginDialogComponent,
    ],
    providers: [LoginDialogService],
    templateUrl: './landing.component.html',
    styleUrl: './landing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent {}
