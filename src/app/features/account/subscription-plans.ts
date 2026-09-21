import type { SubscriptionPlan } from './billing.service';

/** Display prices in USD. Stripe prices configured on the server must match. */
export const SUBSCRIPTION_PLANS: ReadonlyArray<{
    id: SubscriptionPlan; name: string; monthly: number; annual: number; description: string; features: readonly string[];
}> = [
    {
        id: 'premium', name: 'Premium', monthly: 24.99, annual: 249.99,
        description: 'Your trading history, habits, and performance in one workspace.',
        features: ['Broker connections & automatic trade sync', 'Advanced performance analytics',
            'Journal, templates, tags & rule checklists', 'Session alerts & performance guardrails',
            'Factual live position updates with browser voice'],
    },
    {
        id: 'premium_plus', name: 'Premium+', monthly: 34.99, annual: 349.99,
        description: 'Everything in Premium, with AI that helps you review and reflect.',
        features: ['Everything in Premium', 'Personalized daily AI coaching', 'AI reports & chart analysis',
            'AI Live Coach commentary & follow-up questions', 'AI voices, including Cedar'],
    },
];
