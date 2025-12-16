export interface User {
    id: string;
    email: string;
    name: string;
    initials: string;
    plan: string;
    avatar?: string;
}

export interface LoginCredentials {
    email: string;
    password: string;
}
