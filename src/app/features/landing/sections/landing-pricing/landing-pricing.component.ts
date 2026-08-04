import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';
import { AuthService } from '../../../../core/services/auth.service';
import { BillingService, BillingInterval } from '../../../account/billing.service';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

// Real prices — keep in sync with the live Stripe Price objects (create-checkout
// Edge Function resolves the actual charge server-side; these are display-only).
const JOURNAL_MONTHLY = 24.99;
const JOURNAL_ANNUAL = 249.99;
const BUNDLE_MONTHLY = 79.99;

@Component({
    selector: 'app-landing-pricing',
    standalone: true,
    imports: [RevealOnScrollDirective, CurrencyPipe],
    templateUrl: './landing-pricing.component.html',
    styleUrl: './landing-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPricingComponent {
    private auth = inject(AuthService);
    private billing = inject(BillingService);
    private router = inject(Router);

    readonly whopUrl = WHOP_URL;
    readonly bundlePrice = BUNDLE_MONTHLY;
    readonly journalAnnualPrice = JOURNAL_ANNUAL;

    /** Which journal-only cycle is selected — drives both the displayed price
     *  and which Stripe Checkout interval "Subscribe" starts. */
    readonly billingCycle = signal<BillingInterval>('monthly');

    /** The interval whose button is mid-request, so we can disable + label it. */
    readonly checkoutBusy = signal<BillingInterval | null>(null);
    readonly checkoutError = signal<string | null>(null);

    /** Real annual discount vs paying monthly all year — 17% at current prices. */
    readonly annualSavingsPct = Math.round((1 - JOURNAL_ANNUAL / (JOURNAL_MONTHLY * 12)) * 100);

    /** Big headline number on the journal-only card for the selected cycle. */
    readonly journalPrice = computed(() =>
        this.billingCycle() === 'monthly' ? JOURNAL_MONTHLY : JOURNAL_ANNUAL / 12
    );

    /** "less than a coffee" framing — the actual daily cost of the selected cycle. */
    readonly journalPerDay = computed(() =>
        this.billingCycle() === 'monthly' ? JOURNAL_MONTHLY / 30 : JOURNAL_ANNUAL / 365
    );

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

    selectCycle(cycle: BillingInterval): void {
        this.billingCycle.set(cycle);
    }

    /** Subscribe to the journal-only plan at the currently selected cycle.
     *  Logged out → send them to /login (they finish from /account);
     *  logged in → open Stripe Checkout. */
    async subscribe(): Promise<void> {
        if (this.checkoutBusy()) return;
        this.checkoutError.set(null);
        const interval = this.billingCycle();

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
