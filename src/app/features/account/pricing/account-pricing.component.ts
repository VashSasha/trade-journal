import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingPricingComponent } from '../../landing/sections/landing-pricing/landing-pricing.component';

/** Plan comparison inside the app shell, using the same cards as the website. */
@Component({
    selector: 'app-account-pricing',
    standalone: true,
    imports: [RouterLink, LandingPricingComponent],
    templateUrl: './account-pricing.component.html',
    styleUrl: './account-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccountPricingComponent {}
