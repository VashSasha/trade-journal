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
    authToken?: string;     // Signed session JWT for the ai-proxy worker (web Discord login only)
}

export interface LoginCredentials {
    email: string;
    password: string;
}
