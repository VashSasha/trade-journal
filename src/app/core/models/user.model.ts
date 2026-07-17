export type PlanTier = 'free' | 'premium' | 'lifetime' | 'admin';

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
