import { Injectable, signal, computed, inject } from '@angular/core';
import { User, PlanTier, LoginCredentials } from '../models/user.model';
import { DiscordAuthService } from './discord-auth.service';

const STORAGE_KEY = 'trade_journal_user';

const MOCK_USERS: Array<User & { password: string }> = [
    {
        id: '1',
        email: 'sasha@tradejournal.com',
        password: 'demo123',
        name: 'Sasha Vash',
        initials: 'SV',
        plan: 'lifetime'
    },
    {
        id: '2',
        email: 'trader@example.com',
        password: 'password',
        name: 'Jane Smith',
        initials: 'JS',
        plan: 'free'
    }
];

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
        // Treat expired sessions as unauthenticated
        if (user.sessionExpiry && Date.now() > user.sessionExpiry) {
            this.logout();
            return false;
        }
        return true;
    });

    plan = computed((): PlanTier => this.currentUserSignal()?.plan ?? 'free');

    login(credentials: LoginCredentials): { success: boolean; error?: string } {
        const user = MOCK_USERS.find(
            u => u.email === credentials.email && u.password === credentials.password
        );
        if (user) {
            const { password, ...userWithoutPassword } = user;
            this.currentUserSignal.set(userWithoutPassword);
            this.saveUserToStorage(userWithoutPassword);
            return { success: true };
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
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    private saveUserToStorage(user: User): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    }
}
