import type { ParamMap } from '@angular/router';
import type { BillingInterval, SubscriptionPlan } from '../billing.service';

export interface PricingIntent { plan: SubscriptionPlan; interval: BillingInterval; }

/** A display preference, never an entitlement or an instruction to charge. */
export function readPricingIntent(params: Pick<ParamMap, 'get'>): PricingIntent | null {
    const plan = params.get('plan');
    const interval = params.get('interval');
    return (plan === 'premium' || plan === 'premium_plus') && (interval === 'monthly' || interval === 'annual')
        ? { plan, interval } : null;
}

export function pricingReturnUrl(plan: SubscriptionPlan, interval: BillingInterval): string {
    return `/account/pricing?plan=${plan}&interval=${interval}`;
}

export function pricingIntentFromUrl(returnUrl: string): PricingIntent | null {
    const url = new URL(returnUrl, 'https://nvzn.invalid');
    return url.pathname === '/account/pricing' ? readPricingIntent(url.searchParams) : null;
}
