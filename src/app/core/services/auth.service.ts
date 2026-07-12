import { Injectable, signal, computed, inject } from '@angular/core';
import { User, PlanTier, LoginCredentials } from '../models/user.model';
import { DiscordAuthService } from './discord-auth.service';

const STORAGE_KEY = 'trade_journal_user';

// Local-only mock credentials for offline/dev use. Real auth uses Discord OAuth.
// Passwords are stored as SHA-256 hashes — never plaintext in source.
const MOCK_USERS: Array<User & { passwordHash: string }> = [
    {
        id: '1',
        email: 'admin@nvzn.local',
        passwordHash: 'da8b81df6975c703ff93f53564a40d340e91de8e7c2389151832fc3bba79884d',
        name: 'Sasha Vash',
        initials: 'SV',
        plan: 'lifetime'
    },
    {
        id: '2',
        email: 'demo@nvzn.local',
        passwordHash: '35dc0b7ce805d5e9c91c2999b7b09240fe6d35cc7bb1613dc629e7c9efafc7b5',
        name: 'Demo User',
        initials: 'DU',
        plan: 'free'
    }
];

async function hashPassword(password: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private discordAuth = inject(DiscordAuthService);
    private currentUserSignal = signal<User | null>(this.loadUserFromStorage());

    currentUser = this.currentUserSignal.asReadonly();
    isAuthenticated = computed(() => {
        const user = this.currentUserSignal();
        if (!user) return false;
        if (user.sessionExpiry && Date.now() > user.sessionExpiry) return false;
        return true;
    });

    plan = computed((): PlanTier => this.currentUserSignal()?.plan ?? 'free');

    /** Session JWT for the ai-proxy worker (present after web Discord login). */
    authToken = computed((): string | null => this.currentUserSignal()?.authToken ?? null);

    async login(credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> {
        const candidate = MOCK_USERS.find(u => u.email === credentials.email);
        if (candidate) {
            const hash = await hashPassword(credentials.password ?? '');
            if (hash === candidate.passwordHash) {
                const { passwordHash, ...userWithoutPassword } = candidate;
                this.currentUserSignal.set(userWithoutPassword);
                this.saveUserToStorage(userWithoutPassword);
                return { success: true };
            }
        }
        return { success: false, error: 'Invalid email or password' };
    }

    async loginWithDiscord(): Promise<void> {
        const user = await this.discordAuth.loginWithDiscord();
        this.currentUserSignal.set(user);
        this.saveUserToStorage(user);
    }

    async handleWebCallback(code: string): Promise<void> {
        const user = await this.discordAuth.handleWebCallback(code);
        this.currentUserSignal.set(user);
        this.saveUserToStorage(user);
    }

    logout(): void {
        this.currentUserSignal.set(null);
        localStorage.removeItem(STORAGE_KEY);
    }

    private loadUserFromStorage(): User | null {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            const user: User = JSON.parse(stored);
            if (user.sessionExpiry && Date.now() > user.sessionExpiry) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return user;
        } catch {
            return null;
        }
    }

    private saveUserToStorage(user: User): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    }
}
