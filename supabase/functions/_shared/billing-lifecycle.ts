import type Stripe from 'npm:stripe@17.7.0';

export const isPaid = (sub: Stripe.Subscription) => sub.status === 'active' || sub.status === 'trialing';
export const isUnfinished = (sub: Stripe.Subscription) => !['canceled', 'incomplete_expired'].includes(sub.status);
export function currentSubscription(all: Stripe.Subscription[]): Stripe.Subscription | undefined {
    const newest = [...all].sort((a, b) => b.created - a.created);
    return newest.find(isPaid) ?? newest[0];
}
export async function listSubscriptions(client: Stripe, customer: string): Promise<Stripe.Subscription[]> {
    const result: Stripe.Subscription[] = [];
    for await (const sub of client.subscriptions.list({ customer, status: 'all', limit: 100 })) result.push(sub);
    return result;
}
/** Throw on any uncertainty. Callers must retain the user/billing association
 * until this completes. Includes legacy duplicate subscriptions and open carts. */
export async function stopCustomerBilling(client: Stripe, customer: string, renew: () => Promise<void>): Promise<void> {
    for await (const checkout of client.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
        await renew();
        if (checkout.mode === 'subscription') await client.checkout.sessions.expire(checkout.id);
    }
    for (const sub of await listSubscriptions(client, customer)) {
        await renew();
        if (isUnfinished(sub)) await client.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
    }
    if ((await listSubscriptions(client, customer)).some(isUnfinished)) throw new Error('Cancellation incomplete');
}
