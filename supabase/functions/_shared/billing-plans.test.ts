import assert from 'node:assert/strict';
import type Stripe from 'npm:stripe@17.7.0';
import { billingPlanForPrice, checkoutPrice, subscriptionEntitlement } from './billing-plans.ts';

const prices: Record<string, string> = {
    STRIPE_PRICE_MONTHLY: 'price_premium_month', STRIPE_PRICE_ANNUAL: 'price_premium_year',
    STRIPE_PRICE_PREMIUM_PLUS_MONTHLY: 'price_plus_month', STRIPE_PRICE_PREMIUM_PLUS_ANNUAL: 'price_plus_year',
};
const env = (key: string) => prices[key];
const sub = (price: string, status = 'active', created = 1) => ({
    id: price, status, created, items: { data: [{ price: { id: price } }] },
}) as Stripe.Subscription;

Deno.test('checkout accepts only configured tier/interval pairs, including legacy Premium clients', () => {
    assert.equal(checkoutPrice({ interval: 'monthly' }, env), 'price_premium_month');
    for (const plan of ['premium', 'premium_plus']) for (const interval of ['monthly', 'annual']) {
        assert.equal(billingPlanForPrice(checkoutPrice({ plan, interval }, env), env), plan);
    }
    for (const body of [null, {}, { plan: 'admin', interval: 'monthly' }, { plan: 'lifetime', interval: 'annual' },
        { price: 'price_plus_year' }, { plan: 'premium_plus', interval: 'weekly' }]) {
        assert.throws(() => checkoutPrice(body, env));
    }
});

Deno.test('missing, unknown, and ambiguous Stripe prices never grant a tier', () => {
    assert.throws(() => checkoutPrice({ plan: 'premium_plus', interval: 'monthly' }, () => undefined));
    assert.throws(() => billingPlanForPrice('unconfigured', env));
    assert.throws(() => billingPlanForPrice(undefined, env));
    for (const key of ['STRIPE_PRICE_ANNUAL', 'STRIPE_PRICE_PREMIUM_PLUS_MONTHLY']) {
        const duplicate = (name: string) => name === key ? prices.STRIPE_PRICE_MONTHLY : env(name);
        assert.throws(() => checkoutPrice({ plan: 'premium', interval: 'monthly' }, duplicate));
    }
});

Deno.test('current paid Plus wins across duplicates regardless of order; cancellation restores Premium', () => {
    const plus = sub('price_plus_month');
    const premium = sub('price_premium_month', 'active', 2);
    for (const all of [[plus, premium], [premium, plus]]) {
        assert.equal(subscriptionEntitlement(all, env).plan, 'premium_plus');
    }
    assert.equal(subscriptionEntitlement([{ ...plus, status: 'canceled' }, premium], env).plan, 'premium');
    assert.equal(subscriptionEntitlement([sub('price_plus_year', 'trialing')], env).plan, 'premium_plus');
});

Deno.test('inactive, unpaid, or missing subscriptions cannot retain Plus; uncertain paid prices retry', () => {
    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
        assert.equal(subscriptionEntitlement([sub('price_plus_month', status)], env).plan, null);
    }
    assert.equal(subscriptionEntitlement([], env).plan, null);
    assert.throws(() => subscriptionEntitlement([sub('unconfigured')], env));
    const multiple = sub('price_plus_month');
    multiple.items.data.push(multiple.items.data[0]);
    assert.throws(() => subscriptionEntitlement([multiple], env));
});
