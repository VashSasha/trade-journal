import assert from 'node:assert/strict';
import type Stripe from 'npm:stripe@17.7.0';
import { currentSubscription, stopCustomerBilling } from './billing-lifecycle.ts';
import { hasRecentAuthentication } from './recent-auth.ts';

Deno.test('a canceled subscription cannot revoke another active subscription', () => {
    const items = [{ id: 'paid', status: 'active', created: 1 }, { id: 'canceled', status: 'canceled', created: 2 }] as Stripe.Subscription[];
    assert.equal(currentSubscription(items)?.id, 'paid');
    assert.equal(currentSubscription([...items].reverse())?.id, 'paid');
});
Deno.test('recent login is required; token refresh does not count', () => {
    const now = 1_800_000_000_000;
    const token = (amr: unknown) => `header.${btoa(JSON.stringify({ amr }))}.signature`;
    assert.equal(hasRecentAuthentication(token([{ method: 'oauth', timestamp: now / 1000 - 20 }]), now), true);
    assert.equal(hasRecentAuthentication(token([{ method: 'oauth', timestamp: now / 1000 - 3600 }]), now), false);
    assert.equal(hasRecentAuthentication(token([{ method: 'token_refresh', timestamp: now / 1000 - 20 }]), now), false);
    assert.equal(hasRecentAuthentication('malformed', now), false);
});
function fakeStripe(fail = false, refuseCancel = false) {
    const events: string[] = [];
    const subs = [{ id: 'active', status: 'active' }, { id: 'past_due', status: 'past_due' }, { id: 'old', status: 'canceled' }];
    const client = {
        checkout: { sessions: {
            async *list() { yield { id: 'cart', mode: 'subscription' }; },
            expire(id: string) { events.push(`expire:${id}`); return Promise.resolve(); }
        } },
        subscriptions: {
            async *list() { for (const sub of subs) yield sub; },
            cancel(id: string) {
                events.push(`cancel:${id}`);
                if (fail) return Promise.reject(new Error('Stripe unavailable'));
                if (!refuseCancel) subs.find(s => s.id === id)!.status = 'canceled';
                return Promise.resolve();
            }
        }
    } as unknown as Stripe;
    return { client, events };
}
Deno.test('deletion expires open carts and cancels all billable subscriptions', async () => {
    const { client, events } = fakeStripe();
    await stopCustomerBilling(client, 'customer', async () => undefined);
    assert.deepEqual(events, ['expire:cart', 'cancel:active', 'cancel:past_due']);
});
Deno.test('failed or unconfirmed cancellation stops account deletion', async () => {
    await assert.rejects(stopCustomerBilling(fakeStripe(true).client, 'customer', async () => undefined), /unavailable/);
    await assert.rejects(stopCustomerBilling(fakeStripe(false, true).client, 'customer', async () => undefined), /incomplete/);
});
