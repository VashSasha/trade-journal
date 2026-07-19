import { Injectable, signal, computed, inject } from '@angular/core';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User, PlanTier, LoginCredentials } from '../models/user.model';
import { SupabaseService } from './supabase.service';

/** Idle window: sessions expire after this long without user activity. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Idle-expiry timestamp shared across tabs. This is NOT the session itself —
 * Supabase owns the session (tokens, refresh) — it only tracks user activity
 * so SessionTimeoutService can sign out idle users.
 */
const IDLE_EXPIRY_KEY = 'trade_journal_idle_expiry';

interface Profile {
    plan: PlanTier;
    discordId: string | null;
    betaAccess: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private supabase = inject(SupabaseService).client;

    private sessionSignal = signal<Session | null>(null);
    private profileSignal = signal<Profile | null>(null);

    /** Resolves once the initial session restore (and profile load) has settled. */
    readonly authReady: Promise<void>;

    session = this.sessionSignal.asReadonly();

    currentUser = computed((): User | null => {
        const session = this.sessionSignal();
        if (!session) return null;
        return this.buildUser(session.user, this.profileSignal());
    });

    isAuthenticated = computed(() => this.sessionSignal() !== null);

    /** Plan comes from the user's `profiles` row — written only server-side. */
    plan = computed((): PlanTier => this.profileSignal()?.plan ?? 'free');

    /**
     * Closed-beta access, from the user's `profiles` row (written only
     * server-side by resolve-plan). Defaults to false until the profile
     * loads so the beta gate fails closed. Consumed by `betaGuard`.
     */
    betaAccess = computed((): boolean => this.profileSignal()?.betaAccess ?? false);

    /** Supabase access token — sent as the bearer token to backend services. */
    authToken = computed((): string | null => this.sessionSignal()?.access_token ?? null);

    constructor() {
        this.authReady = this.initialize();

        this.supabase.auth.onAuthStateChange((event, session) => {
            this.sessionSignal.set(session);
            if (event === 'SIGNED_OUT' || !session) {
                this.profileSignal.set(null);
                localStorage.removeItem(IDLE_EXPIRY_KEY);
                return;
            }
            if (event === 'SIGNED_IN') {
                this.refreshSessionExpiry();
                // Defer Supabase calls out of the auth callback (supabase-js
                // serializes calls made inside onAuthStateChange).
                setTimeout(() => void this.loadProfile(session.user.id));
            }
        });
    }

    private async initialize(): Promise<void> {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) return;

        // Enforce the idle timeout across restarts: a restored session whose
        // idle window lapsed while the app was closed is signed out, not resumed.
        const idleExpiry = this.storedSessionExpiry();
        if (idleExpiry !== null && Date.now() > idleExpiry) {
            await this.supabase.auth.signOut();
            return;
        }

        this.sessionSignal.set(session);
        this.refreshSessionExpiry();
        await this.loadProfile(session.user.id);
    }

    async login(credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> {
        const { error } = await this.supabase.auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password
        });
        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true };
    }

    /** Redirects to Discord OAuth — the promise resolves just before navigation. */
    async loginWithDiscord(returnUrl?: string): Promise<void> {
        const redirectTo = new URL('/auth/callback', window.location.origin);
        if (returnUrl) redirectTo.searchParams.set('returnUrl', returnUrl);

        const { error } = await this.supabase.auth.signInWithOAuth({
            provider: 'discord',
            options: {
                scopes: 'identify email guilds.members.read',
                redirectTo: redirectTo.toString()
            }
        });
        if (error) throw new Error(error.message);
    }

    /**
     * Ask the resolve-plan Edge Function to verify Discord roles and update
     * the profile. Called from the OAuth callback with the Discord provider
     * token (only available in the session immediately after OAuth login).
     */
    async resolvePlan(providerToken: string): Promise<void> {
        const { error } = await this.supabase.functions.invoke('resolve-plan', {
            body: { provider_token: providerToken }
        });
        if (error) throw new Error(`Plan resolution failed: ${error.message}`);
        await this.refreshProfile();
    }

    /** Re-read the caller's profiles row (plan may have changed server-side). */
    async refreshProfile(): Promise<void> {
        const session = this.sessionSignal();
        if (session) await this.loadProfile(session.user.id);
    }

    /** Slide the idle window forward. Called by SessionTimeoutService on user activity. */
    refreshSessionExpiry(): void {
        if (!this.sessionSignal()) return;
        localStorage.setItem(IDLE_EXPIRY_KEY, String(Date.now() + SESSION_IDLE_TIMEOUT_MS));
    }

    /**
     * Idle expiry as persisted in localStorage — the cross-tab source of truth
     * (activity in another tab keeps this one alive). Null when logged out.
     */
    storedSessionExpiry(): number | null {
        const stored = localStorage.getItem(IDLE_EXPIRY_KEY);
        if (!stored) return null;
        const expiry = Number(stored);
        return Number.isFinite(expiry) ? expiry : null;
    }

    logout(): void {
        // Clear local state immediately so guards react without waiting on the network.
        this.sessionSignal.set(null);
        this.profileSignal.set(null);
        localStorage.removeItem(IDLE_EXPIRY_KEY);
        void this.supabase.auth.signOut();
    }

    private async loadProfile(userId: string): Promise<void> {
        const { data, error } = await this.supabase
            .from('profiles')
            .select('plan, discord_id, beta_access')
            .eq('id', userId)
            .single();

        if (error || !data) {
            // RLS guarantees at most the caller's own row; a miss means the
            // trigger hasn't created it yet — treat as free rather than failing.
            this.profileSignal.set(null);
            return;
        }
        this.profileSignal.set({
            plan: data.plan as PlanTier,
            discordId: data.discord_id ?? null,
            betaAccess: data.beta_access ?? false
        });
    }

    private buildUser(user: SupabaseUser, profile: Profile | null): User {
        const meta = user.user_metadata ?? {};
        const name: string = meta['full_name'] || meta['name'] || meta['user_name'] || user.email || 'Trader';
        const initials = name
            .split(/\s+/)
            .map((w: string) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
        const discordIdentity = user.identities?.find(i => i.provider === 'discord');

        return {
            id: user.id,
            email: user.email ?? '',
            name,
            initials,
            avatar: meta['avatar_url'] ?? undefined,
            discordId: profile?.discordId ?? discordIdentity?.id,
            plan: profile?.plan ?? 'free'
        };
    }
}
