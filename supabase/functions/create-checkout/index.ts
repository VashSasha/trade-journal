import { admin, stripe, withBillingLock, readBilling, subscriptions, isUnfinished,
    BillingError, check, cors, json, verifyUser } from '../_shared/billing.ts';

Deno.serve(async req => {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    try {
        const { user } = await verifyUser(req);
        const body = await req.json();
        const price = body.interval === 'monthly' ? Deno.env.get('STRIPE_PRICE_MONTHLY') :
            body.interval === 'annual' ? Deno.env.get('STRIPE_PRICE_ANNUAL') : null;
        if (!price) throw new BillingError('Choose a configured monthly or annual plan.', 400);
        const origin = Deno.env.get('APP_ORIGIN');
        if (!origin || new URL(origin).protocol !== 'https:') throw new BillingError('Billing is not configured.', 503);

        const url = await withBillingLock(user.id, async (_token, renew) => {
            let billing = await readBilling(user.id);
            if (billing?.deletion_pending) throw new BillingError('Account deletion is in progress.');
            let customer = billing?.stripe_customer_id;
            if (!customer) {
                // Stable parameters/key make retries and competing requests reuse one customer.
                const created = await stripe.customers.create({ metadata: { user_id: user.id } },
                    { idempotencyKey: `nvzn-customer:${user.id}` });
                customer = created.id;
                await renew();
                const { error } = await admin.from('billing').upsert({ user_id: user.id, stripe_customer_id: customer }, { onConflict: 'user_id' });
                check(error);
            }
            if ((await subscriptions(customer)).some(isUnfinished)) {
                throw new BillingError('You already have a subscription. Use Manage billing to change or resume it.');
            }
            await renew();
            // Recover an open session even if a prior request lost its response or
            // an older version of the application did not persist the session ID.
            for await (const open of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
                if (open.mode !== 'subscription') continue;
                const lines = await stripe.checkout.sessions.listLineItems(open.id, { limit: 10 });
                if (lines.data.length === 1 && lines.data[0].price?.id === price && open.url) return open.url;
                await renew();
                await stripe.checkout.sessions.expire(open.id);
            }
            billing = await readBilling(user.id);
            let attempt = billing?.checkout_attempt;
            if (billing?.checkout_session_id) {
                const old = await stripe.checkout.sessions.retrieve(billing.checkout_session_id);
                if (old.status === 'complete') throw new BillingError('Your checkout is being processed. Please refresh shortly.');
                if (old.status === 'expired') attempt = null;
            }
            if (billing?.checkout_price_id !== price) attempt = null;
            attempt ??= crypto.randomUUID();
            await renew();
            check((await admin.from('billing').update({ checkout_attempt: attempt, checkout_price_id: price,
                checkout_session_id: null }).eq('user_id', user.id)).error);
            const checkout = await stripe.checkout.sessions.create({
                mode: 'subscription', customer, line_items: [{ price, quantity: 1 }],
                client_reference_id: user.id, metadata: { user_id: user.id },
                subscription_data: { metadata: { user_id: user.id } },
                success_url: `${origin}/account?checkout=success`, cancel_url: `${origin}/account?checkout=cancel`
            }, { idempotencyKey: `nvzn-checkout:${user.id}:${attempt}` });
            await renew();
            check((await admin.from('billing').update({ checkout_session_id: checkout.id })
                .eq('user_id', user.id)).error);
            if (!checkout.url) throw new BillingError('Checkout did not return a URL.', 503);
            return checkout.url;
        });
        return json({ url }, 200, headers);
    } catch (error) {
        console.error('create-checkout failed', error instanceof Error ? error.name : 'Billing error');
        return json({ error: error instanceof BillingError ? error.message : 'Unable to start checkout. Please retry.' },
            error instanceof BillingError ? error.status : 500, headers);
    }
});
