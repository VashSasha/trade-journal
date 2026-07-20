import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';

export type BillingInterval = 'monthly' | 'annual';

/** The caller's own `billing` row (select-own RLS). Null when never subscribed. */
export interface BillingRecord {
    status: string | null;
    priceId: string | null;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
}

/**
 * Wraps the three Stripe Edge Functions (create-checkout, create-portal-session)
 * plus reading the owner-visible `billing` row. Shared by the landing pricing
 * card and the Account billing section, so it's root-provided and stateless —
 * all subscription writes happen server-side in stripe-webhook.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
    private supabase = inject(SupabaseService).client;
    private auth = inject(AuthService);

    /** Read the current user's billing row, or null if none / signed out. */
    async loadBilling(): Promise<BillingRecord | null> {
        const uid = this.auth.session()?.user.id;
        if (!uid) return null;
        const { data } = await this.supabase
            .from('billing')
            .select('status, price_id, current_period_end, stripe_customer_id, stripe_subscription_id')
            .eq('user_id', uid)
            .maybeSingle();
        if (!data) return null;
        return {
            status: data.status ?? null,
            priceId: data.price_id ?? null,
            currentPeriodEnd: data.current_period_end ?? null,
            stripeCustomerId: data.stripe_customer_id ?? null,
            stripeSubscriptionId: data.stripe_subscription_id ?? null,
        };
    }

    /**
     * Start Checkout for the chosen interval and return the hosted Stripe URL.
     * The amount is resolved server-side from a price id — never sent from here.
     */
    async startCheckout(interval: BillingInterval): Promise<{ url?: string; error?: string }> {
        const { data, error } = await this.supabase.functions.invoke('create-checkout', {
            body: { interval },
        });
        if (error) return { error: await this.functionError(error, 'Could not start checkout.') };
        return { url: (data as { url?: string })?.url };
    }

    /** Open the Stripe Billing Portal and return its hosted URL. */
    async openPortal(): Promise<{ url?: string; error?: string }> {
        const { data, error } = await this.supabase.functions.invoke('create-portal-session', {
            body: {},
        });
        if (error) return { error: await this.functionError(error, 'Could not open the billing portal.') };
        return { url: (data as { url?: string })?.url };
    }

    /** Pull the function's JSON error body out of a FunctionsHttpError, if any. */
    private async functionError(error: unknown, fallback: string): Promise<string> {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        return body?.error || fallback;
    }
}
