export type PlanTier = 'free' | 'premium' | 'lifetime' | 'admin';

export interface User {
    id: string;
    email: string;
    name: string;
    initials: string;
    plan: PlanTier;
    avatar?: string;
    discordId?: string;
    sessionExpiry?: number; // Unix timestamp ms
}

export interface LoginCredentials {
    email: string;
    password: string;
}
