import { Injectable, signal, computed } from '@angular/core';
import { User, LoginCredentials } from '../models/user.model';

// Mock user database
const MOCK_USERS: Array<User & { password: string }> = [
    {
        id: '1',
        email: 'sasha@tradejournal.com',
        password: 'demo123',
        name: 'Sasha Vash',
        initials: 'SV',
        plan: 'Pro Plan'
    },
    {
        id: '2',
        email: 'trader@example.com',
        password: 'password',
        name: 'Jane Smith',
        initials: 'JS',
        plan: 'Free Plan'
    }
];

const STORAGE_KEY = 'trade_journal_user';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    // Signal for current user
    private currentUserSignal = signal<User | null>(this.loadUserFromStorage());

    // Public readonly signals
    currentUser = this.currentUserSignal.asReadonly();
    isAuthenticated = computed(() => this.currentUserSignal() !== null);

    constructor() { }

    /**
     * Mock login - validates credentials against mock database
     */
    login(credentials: LoginCredentials): { success: boolean; error?: string } {
        const user = MOCK_USERS.find(
            u => u.email === credentials.email && u.password === credentials.password
        );

        if (user) {
            // Remove password from user object
            const { password, ...userWithoutPassword } = user;

            // Update signal
            this.currentUserSignal.set(userWithoutPassword);

            // Persist to localStorage
            this.saveUserToStorage(userWithoutPassword);

            return { success: true };
        }

        return {
            success: false,
            error: 'Invalid email or password'
        };
    }

    /**
     * Logout - clear user state
     */
    logout(): void {
        this.currentUserSignal.set(null);
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * Load user from localStorage on app init
     */
    private loadUserFromStorage(): User | null {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    /**
     * Save user to localStorage
     */
    private saveUserToStorage(user: User): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    }
}
