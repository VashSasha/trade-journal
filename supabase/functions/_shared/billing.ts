import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { listSubscriptions } from './billing-lifecycle.ts';
export { isPaid, isUnfinished } from './billing-lifecycle.ts';

export { Stripe };
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
});
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient(),
    timeout: 10_000, maxNetworkRetries: 1
});
export class BillingError extends Error {
    constructor(message: string, public status = 409) { super(message); }
}
export function check(error: unknown): void { if (error) throw error; }

// Serialize checkout, deletion, and webhook reconciliation per user across
// Edge Function instances. A crashed instance releases automatically by expiry.
export async function withBillingLock<T>(userId: string, work: (token: string, renew: () => Promise<void>) => Promise<T>): Promise<T> {
    const token = crypto.randomUUID();
    const { data, error } = await admin.rpc('acquire_billing_operation', { p_user_id: userId, p_token: token });
    check(error);
    if (!data) throw new BillingError('A billing update is in progress. Please try again shortly.');
    const renew = async () => {
        const { data: row, error: err } = await admin.from('billing_operations')
            .update({ expires_at: new Date(Date.now() + 300_000).toISOString() })
            .eq('user_id', userId).eq('token', token).gt('expires_at', new Date().toISOString())
            .select('token').maybeSingle();
        check(err);
        if (!row) throw new BillingError('Billing operation expired. Please retry.');
    };
    try { return await work(token, renew); }
    finally {
        await admin.from('billing_operations').delete().eq('user_id', userId).eq('token', token);
    }
}
export async function readBilling(userId: string) {
    const { data, error } = await admin.from('billing').select('*').eq('user_id', userId).maybeSingle();
    check(error); return data;
}
export async function subscriptions(customer: string): Promise<Stripe.Subscription[]> {
    return listSubscriptions(stripe, customer);
}

export function cors(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') ?? '';
    if (!['http://localhost:4200', Deno.env.get('APP_ORIGIN')].includes(origin)) return {};
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
export function json(body: unknown, status: number, headers: Record<string, string>): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
export async function verifyUser(req: Request) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) throw new BillingError('Missing authorization', 401);
    const { data, error } = await admin.auth.getUser(jwt);
    if (!jwt || error || !data.user) throw new BillingError('Invalid or expired token', 401);
    return { user: data.user, jwt };
}
