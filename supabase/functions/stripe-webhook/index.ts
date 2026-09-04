import { admin, stripe, Stripe, withBillingLock, subscriptions, check } from '../_shared/billing.ts';
import { currentSubscription } from '../_shared/billing-lifecycle.ts';

Deno.serve(async req => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(await req.text(),
            req.headers.get('stripe-signature') ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
    } catch { return new Response('Invalid signature', { status: 400 }); }
    const types = new Set(['checkout.session.completed', 'customer.subscription.created',
        'customer.subscription.updated', 'customer.subscription.deleted']);
    if (!types.has(event.type)) return Response.json({ received: true });
    try {
        const { data: processed, error: processedError } = await admin.from('billing_events')
            .select('event_id').eq('event_id', event.id).maybeSingle();
        check(processedError);
        if (processed) return Response.json({ received: true });
        const object = event.data.object as Stripe.Subscription | Stripe.Checkout.Session;
        const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
        if (!customer) throw new Error('Missing customer');
        const { data: billing, error } = await admin.from('billing').select('user_id')
            .eq('stripe_customer_id', customer).maybeSingle();
        check(error);
        if (!billing) {
            const { data: deleted, error: deletedError } = await admin.from('deleted_billing_customers')
                .select('customer_id').eq('customer_id', customer).maybeSingle();
            check(deletedError);
            if (deleted) return Response.json({ received: true });
            // Retry unknown mappings instead of silently dropping paid access.
            throw new Error('Unresolved customer');
        }
        await withBillingLock(billing.user_id, async (token, renew) => {
            // Stripe does not guarantee delivery order. Reconcile CURRENT state
            // for the entire customer, not the subscription snapshot in the event.
            const all = await subscriptions(customer);
            const current = currentSubscription(all);
            await renew();
            const item = current?.items.data[0];
            check((await admin.rpc('apply_billing_snapshot', {
                p_user_id: billing.user_id, p_token: token, p_event_id: event.id, p_customer_id: customer,
                p_subscription_id: current?.id ?? null, p_status: current?.status ?? 'canceled',
                p_price_id: item?.price.id ?? null,
                p_period_end: current?.current_period_end ? new Date(current.current_period_end * 1000).toISOString() : null
            })).error);
        });
        return Response.json({ received: true });
    } catch {
        // Non-2xx makes Stripe retry. Event receipt, billing, and plan are committed
        // together by the RPC, so a failed handler never leaves half-updated access.
        return new Response('Billing reconciliation pending', { status: 500 });
    }
});
