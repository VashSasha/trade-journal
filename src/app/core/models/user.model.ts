export type PlanTier = 'free' | 'premium' | 'premium_plus' | 'lifetime' | 'admin';

export const PLAN_LABELS: Record<PlanTier, string> = {
    free: 'Free', premium: 'Premium', premium_plus: 'Premium+', lifetime: 'Lifetime', admin: 'Admin',
};
export const planLabel = (plan: PlanTier): string => PLAN_LABELS[plan] ?? 'Free';
export const isPaidPlan = (plan: string | null): boolean => ['premium', 'premium_plus', 'lifetime', 'admin'].includes(plan ?? '');
export const planRank = (plan: string | null): number =>
    ({ free: 1, premium: 2, lifetime: 3, premium_plus: 4, admin: 5 }[plan ?? ''] ?? 0);

export interface User {
    id: string;
    email: string;
    name: string;
    initials: string;
    plan: PlanTier;
    avatar?: string;
    discordId?: string;
}

export interface LoginCredentials {
    email: string;
    password: string;
}
