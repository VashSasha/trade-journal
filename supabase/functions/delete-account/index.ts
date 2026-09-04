import { admin, stripe, withBillingLock, readBilling,
    BillingError, check, cors, json, verifyUser } from '../_shared/billing.ts';
import { hasRecentAuthentication } from '../_shared/recent-auth.ts';
import { stopCustomerBilling } from '../_shared/billing-lifecycle.ts';

Deno.serve(async req => {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    try {
        const { user, jwt } = await verifyUser(req);
        if (!hasRecentAuthentication(jwt)) throw new BillingError('Please sign out and sign in again before deleting your account.', 403);
        await withBillingLock(user.id, async (_token, renew) => {
            const billing = await readBilling(user.id);
            // Durable fail-closed state: checkout stays blocked if cancellation
            // partially fails. Retrying deletion safely completes the operation.
            check((await admin.from('billing').upsert({ user_id: user.id, deletion_pending: true }, { onConflict: 'user_id' })).error);
            const customer = billing?.stripe_customer_id;
            if (customer) {
                await stopCustomerBilling(stripe, customer, renew);
                await renew();
                check((await admin.from('deleted_billing_customers').upsert({ customer_id: customer })).error);
            }
            await renew();
            // Keep the billing link and user intact if ANY preceding step failed.
            check((await admin.auth.admin.deleteUser(user.id)).error);
        });
        return json({ deleted: true }, 200, headers);
    } catch (error) {
        return json({ error: error instanceof BillingError ? error.message :
            'Deletion is not complete. Your account has been retained; please retry or contact support.' },
            error instanceof BillingError ? error.status : 500, headers);
    }
});
