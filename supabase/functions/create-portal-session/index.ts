// The customer is loaded from the authenticated user's billing row, never the request body.
import { stripe, BillingError, cors, json, verifyUser, readBilling } from '../_shared/billing.ts';

Deno.serve(async req => {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    try {
        const { user } = await verifyUser(req);
        const billing = await readBilling(user.id);
        if (!billing?.stripe_customer_id) throw new BillingError('No billing account for this user.', 404);
        if (billing.deletion_pending) throw new BillingError('Account deletion is in progress.');
        const origin = Deno.env.get('APP_ORIGIN');
        if (!origin || new URL(origin).protocol !== 'https:') throw new BillingError('Billing is not configured.', 503);
        const session = await stripe.billingPortal.sessions.create({
            customer: billing.stripe_customer_id,
            return_url: `${origin}/account/plan`,
        });
        return json({ url: session.url }, 200, headers);
    } catch (error) {
        console.error('create-portal-session failed', error instanceof Error ? error.name : 'Billing error');
        return json({ error: error instanceof BillingError ? error.message : 'Could not open the billing portal. Please retry.' },
            error instanceof BillingError ? error.status : 500, headers);
    }
});
