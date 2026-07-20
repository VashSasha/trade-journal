import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';
import { AuthService } from '../../../../core/services/auth.service';
import { BillingService, BillingInterval } from '../../../account/billing.service';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

@Component({
    selector: 'app-landing-pricing',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-pricing.component.html',
    styleUrl: './landing-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPricingComponent {
    private auth = inject(AuthService);
    private billing = inject(BillingService);
    private router = inject(Router);

    readonly whopUrl = WHOP_URL;

    /** The interval whose button is mid-request, so we can disable + label it. */
    readonly checkoutBusy = signal<BillingInterval | null>(null);
    readonly checkoutError = signal<string | null>(null);

    readonly journalFeatures: string[] = [
        'Tradovate auto-sync with FIFO trade matching',
        'Full analytics — equity curve, win rate, profit factor',
        'Daily journal, templates, tags & rule checklists',
        'AI-powered trade reports'
    ];

    readonly communityFeatures: string[] = [
        'Private NVZN Trading Discord community',
        'Live trade ideas from active traders',
        'Direct member support'
    ];

    /**
     * Subscribe to the journal-only plan. Logged out → send them to /login
     * (they finish from /account); logged in → open Stripe Checkout.
     */
    async subscribe(interval: BillingInterval): Promise<void> {
        if (this.checkoutBusy()) return;
        this.checkoutError.set(null);

        if (!this.auth.isAuthenticated()) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: '/account' } });
            return;
        }

        this.checkoutBusy.set(interval);
        const { url, error } = await this.billing.startCheckout(interval);
        if (url) {
            window.location.assign(url);
            return; // navigating away — keep the button busy
        }
        this.checkoutError.set(error ?? 'Could not start checkout.');
        this.checkoutBusy.set(null);
    }
}
