import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { LandingPricingComponent } from '../../landing/sections/landing-pricing/landing-pricing.component';
import { readPricingIntent } from './pricing-intent';

/** Plan comparison inside the app shell, using the same cards as the website. */
@Component({
    selector: 'app-account-pricing',
    standalone: true,
    imports: [RouterLink, LandingPricingComponent],
    templateUrl: './account-pricing.component.html',
    styleUrl: './account-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccountPricingComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
    readonly selection = computed(() => readPricingIntent(this.query()));
}
