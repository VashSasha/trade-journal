import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';
import { AuthService } from '../../../../core/services/auth.service';
import { isPaidPlan } from '../../../../core/models/user.model';
import { BillingService, BillingInterval, SubscriptionPlan } from '../../../account/billing.service';
import { SUBSCRIPTION_PLANS } from '../../../account/subscription-plans';

@Component({
    selector: 'app-landing-pricing', standalone: true,
    imports: [RevealOnScrollDirective, CurrencyPipe, RouterLink],
    templateUrl: './landing-pricing.component.html',
    styleUrl: './landing-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPricingComponent {
    private auth = inject(AuthService);
    private billing = inject(BillingService);
    private router = inject(Router);
    readonly embedded = input(false);
    readonly plans = SUBSCRIPTION_PLANS;
    readonly whopUrl = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';
    readonly billingCycle = signal<BillingInterval>('monthly');
    readonly checkoutBusy = signal<SubscriptionPlan | null>(null);
    readonly checkoutError = signal<string | null>(null);

    includes(plan: SubscriptionPlan): boolean {
        if (!this.auth.isAuthenticated()) return false;
        if (plan === 'premium') return isPaidPlan(this.auth.plan());
        return ['premium_plus', 'admin'].includes(this.auth.plan()) || (isPaidPlan(this.auth.plan()) && this.auth.aiAccess());
    }

    selectCycle(cycle: BillingInterval): void {
        if (!this.checkoutBusy()) this.billingCycle.set(cycle);
    }

    async subscribe(plan: SubscriptionPlan = 'premium'): Promise<void> {
        if (this.checkoutBusy()) return;
        this.checkoutError.set(null);
        if (!this.auth.isAuthenticated()) {
            void this.router.navigate(['/login'], { queryParams: { returnUrl: '/account/pricing' } });
            return;
        }
        if (this.includes(plan)) {
            void this.router.navigate(['/account/plan']);
            return;
        }
        const interval = this.billingCycle();
        this.checkoutBusy.set(plan);
        try {
            // Existing subscribers change plans in Stripe, never create a second subscription.
            const current = await this.billing.loadBilling();
            const existing = current?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(current.status ?? '');
            const { url, error } = existing
                ? await this.billing.openPortal()
                : await this.billing.startCheckout(interval, plan);
            if (url) { window.location.assign(url); return; }
            this.checkoutError.set(error ?? 'Could not open billing. Please try again.');
        } catch {
            this.checkoutError.set('Could not open billing. Please try again.');
        }
        this.checkoutBusy.set(null);
    }
}
