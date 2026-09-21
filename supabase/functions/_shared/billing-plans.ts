import { RequestError } from './request-body.ts';
import type Stripe from 'npm:stripe@17.7.0';
import { currentSubscription, isPaid } from './billing-lifecycle.ts';

export type SubscriptionPlan = 'premium' | 'premium_plus';
type Env = (name: string) => string | undefined;
const KEYS = {
    premium: { monthly: 'STRIPE_PRICE_MONTHLY', annual: 'STRIPE_PRICE_ANNUAL' },
    premium_plus: { monthly: 'STRIPE_PRICE_PREMIUM_PLUS_MONTHLY', annual: 'STRIPE_PRICE_PREMIUM_PLUS_ANNUAL' },
} as const;

/** Only operator-configured Stripe prices can grant journal subscriptions. */
export function billingPlanForPrice(priceId: string | undefined, env: Env): SubscriptionPlan {
    const matches = (Object.keys(KEYS) as SubscriptionPlan[]).flatMap(plan =>
        Object.values(KEYS[plan]).filter(key => !!priceId && env(key)?.trim() === priceId).map(() => plan));
    if (matches.length !== 1) throw new RequestError('Subscription price is not configured correctly.', 503);
    return matches[0];
}

/** Reconcile current Stripe state, including any legacy duplicate subscriptions. */
export function subscriptionEntitlement(all: Stripe.Subscription[], env: Env) {
    const paid = all.filter(isPaid).map(subscription => {
        if (subscription.items.data.length !== 1) throw new RequestError('Unsupported subscription items.', 503);
        return { subscription, plan: billingPlanForPrice(subscription.items.data[0]?.price.id, env) };
    }).sort((a, b) => Number(b.plan === 'premium_plus') - Number(a.plan === 'premium_plus')
        || b.subscription.created - a.subscription.created);
    return paid[0] ?? { subscription: currentSubscription(all), plan: null };
}

export function checkoutPrice(body: unknown, env: Env): string {
    const input = body as { plan?: unknown; interval?: unknown } | null;
    const plan = input?.plan ?? 'premium'; // Existing clients still select the base plan.
    const interval = input?.interval;
    if ((plan !== 'premium' && plan !== 'premium_plus') || (interval !== 'monthly' && interval !== 'annual')) {
        throw new RequestError('Choose Premium or Premium+ and a monthly or annual interval.', 400);
    }
    const price = env(KEYS[plan][interval])?.trim();
    if (!price || billingPlanForPrice(price, env) !== plan) {
        throw new RequestError('This subscription is not available yet. Please try again later.', 503);
    }
    return price;
}
