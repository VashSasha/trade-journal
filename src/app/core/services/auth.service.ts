import { Injectable, signal, computed, inject } from '@angular/core';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User, PlanTier, LoginCredentials } from '../models/user.model';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';

/**
 * Long-inactivity backstop: sign out after 7 days with no user input.
 * This is intentionally generous so the journal open in a background tab
 * during a trading session is never interrupted. It is not a security
 * timeout — it exists solely to reclaim sessions on shared/abandoned machines.
 */
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Idle-expiry timestamp shared across tabs. This is NOT the session itself —
 * Supabase owns the session (tokens, refresh) — it only tracks user activity
 * so SessionTimeoutService can sign out after prolonged inactivity.
 */
const IDLE_EXPIRY_KEY = 'trade_journal_idle_expiry';
const PROFILE_CACHE_MS = 30_000;
const OAUTH_PROVIDER_KEY = 'nvzn_pending_oauth_provider';

interface Profile {
    plan: PlanTier;
    discordId: string | null;
    betaAccess: boolean;
}

interface Entitlements {
    plan: PlanTier;
    discord_id: string | null;
    beta_access: boolean;
    discord_plan_expires_at: string | null;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private supabase = inject(SupabaseService).client;
    private userSession = inject(UserSessionService);

    private sessionSignal = signal<Session | null>(null);
    private profileSignal = signal<Profile | null>(null);
    private profileRequest = 0;
    private profileLoad: { userId: string; promise: Promise<void> } | null = null;
    private profileFreshUntil = 0;
    // Only keep a credential verified during an explicit Discord callback.
    // Linked identities / app_metadata.provider do not identify the provider
    // of session.provider_token (a linked user can sign in through Google).
    private discordCredential: { userId: string; token: string } | null = null;
    readonly discordReauthRequired = signal(false);

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
        const refresh = () => { void this.refreshProfile().catch(() => undefined); };
        window.addEventListener('focus', refresh);
        setInterval(refresh, 15 * 60 * 1000);

        this.supabase.auth.onAuthStateChange((event, session) => {
            if (session?.user.id !== this.sessionSignal()?.user.id) {
                this.resetProfile();
            } else if (event === 'SIGNED_IN' && session?.provider_token &&
                session.provider_token !== this.discordCredential?.token) {
                this.discordCredential = null;
            }
            this.sessionSignal.set(session);
            if (event === 'SIGNED_OUT' || !session) {
                this.resetProfile();
                localStorage.removeItem(IDLE_EXPIRY_KEY);
                return;
            }
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                this.refreshSessionExpiry();
                // Defer Supabase calls out of the auth callback (supabase-js
                // serializes calls made inside onAuthStateChange).
                setTimeout(() => void this.refreshProfile().catch(() => undefined));
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
            await this.supabase.auth.signOut({ scope: 'local' });
            return;
        }

        this.sessionSignal.set(session);
        this.refreshSessionExpiry();
        await this.refreshProfile();
    }

    async login(credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> {
        this.discordCredential = null;
        sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
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
        this.rememberOAuthProvider('discord');
        const redirectTo = new URL('/auth/callback', window.location.origin);
        if (returnUrl) redirectTo.searchParams.set('returnUrl', returnUrl);

        const { error } = await this.supabase.auth.signInWithOAuth({
            provider: 'discord',
            options: {
                scopes: 'identify email guilds.members.read',
                redirectTo: redirectTo.toString()
            }
        });
        if (error) {
            sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
            throw new Error(error.message);
        }
    }

    /** Redirects to Google OAuth — mirrors loginWithDiscord for non-Discord signups. */
    async loginWithGoogle(returnUrl?: string): Promise<void> {
        this.rememberOAuthProvider('google');
        const redirectTo = new URL('/auth/callback', window.location.origin);
        if (returnUrl) redirectTo.searchParams.set('returnUrl', returnUrl);

        const { error } = await this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectTo.toString() }
        });
        if (error) {
            sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
            throw new Error(error.message);
        }
    }

    /**
     * Finish a login/link callback. Only a Discord flow sends its provider
     * token to resolve-plan; the server must still verify identity and roles.
     */
    async completeOAuth(provider?: string | null): Promise<void> {
        await this.authReady;
        const initiatedProvider = this.consumeOAuthProvider();
        // Identity-link callbacks already name their provider. Login callbacks
        // use a one-shot, tab-local marker so existing redirect URLs stay valid.
        provider ??= initiatedProvider;
        if (provider !== 'discord') {
            this.discordCredential = null;
            return;
        }
        const providerToken = this.sessionSignal()?.provider_token;
        if (!providerToken) return;
        const scope = this.userSession.capture();
        const { error } = await this.supabase.functions.invoke('resolve-plan', {
            body: { provider_token: providerToken }, signal: scope.signal
        });
        if (!this.userSession.isCurrent(scope)) return;
        if (error) throw new Error(`Plan resolution failed: ${error.message}`);
        this.discordCredential = { userId: scope.userId, token: providerToken };
        await this.refreshProfile({ force: true });
    }

    /**
     * Clear the Discord plan source after the user unlinks Discord. The Edge
     * Function nulls discord_plan/discord_id (only if no Discord identity
     * remains), then we refresh so the derived plan display updates.
     */
    async clearDiscordPlan(): Promise<void> {
        this.discordCredential = null;
        const { error } = await this.supabase.functions.invoke('resolve-plan', {
            body: { clear: true }
        });
        if (error) throw new Error(`Failed to clear Discord plan: ${error.message}`);
        await this.refreshProfile({ force: true });
    }

    /** Coalesce guard/auth/focus checks; explicit entitlement changes bypass the short cache. */
    async refreshProfile({ force = false }: { force?: boolean } = {}): Promise<void> {
        const userId = this.sessionSignal()?.user.id;
        if (!userId) return;
        if (force) {
            // A read started before a mutation must not hide its new result.
            if (this.profileLoad?.userId === userId) await this.profileLoad.promise;
            this.profileFreshUntil = 0;
        }
        if (this.sessionSignal()?.user.id !== userId) return;
        if (this.profileLoad?.userId === userId) return this.profileLoad.promise;
        if (Date.now() < this.profileFreshUntil) return;

        const pending = { userId, promise: this.loadProfile(userId) };
        this.profileLoad = pending;
        try { await pending.promise; }
        finally { if (this.profileLoad === pending) this.profileLoad = null; }
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
        this.userSession.clear();
        // Clear local state immediately so guards react without waiting on the network.
        this.sessionSignal.set(null);
        this.resetProfile();
        localStorage.removeItem(IDLE_EXPIRY_KEY);
        sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
        void this.supabase.auth.signOut();
    }

    private async loadProfile(userId: string): Promise<void> {
        const request = ++this.profileRequest;
        await this.userSession.ready;
        if (this.sessionSignal()?.user.id !== userId || request !== this.profileRequest) return;
        const scope = this.userSession.capture();
        const current = () => this.userSession.isCurrent(scope) &&
            this.sessionSignal()?.user.id === userId && request === this.profileRequest;
        const read = () => this.supabase.rpc('get_my_entitlements').abortSignal(scope.signal).single<Entitlements>();
        let { data, error } = await read();

        if (!current()) return;
        const token = this.discordCredential?.userId === userId ? this.discordCredential.token : null;
        const expiry = data?.discord_plan_expires_at ? Date.parse(data.discord_plan_expires_at) : 0;
        // Renew opportunistically without persisting additional provider tokens.
        // Missing/expired provider credentials require a new Discord sign-in;
        // they never extend the previous role grant.
        if (data?.discord_id && token && expiry < Date.now() + 15 * 60 * 1000) {
            const renewed = await this.supabase.functions.invoke('resolve-plan', {
                body: { provider_token: token }, signal: scope.signal
            });
            if (!current()) return;
            if (!renewed.error) ({ data, error } = await read());
            else this.discordCredential = null; // Don't repeatedly retry a rejected credential.
        }

        if (!current()) return;

        if (error || !data) {
            // RLS guarantees at most the caller's own row; a miss means the
            // trigger hasn't created it yet — treat as free rather than failing.
            this.profileSignal.set(null);
            this.discordReauthRequired.set(false);
            return;
        }
        this.profileSignal.set({
            plan: data.plan as PlanTier,
            discordId: data.discord_id ?? null,
            betaAccess: data.beta_access ?? false
        });
        this.discordReauthRequired.set(!!data.discord_id && data.plan === 'free' &&
            (!data.discord_plan_expires_at || Date.parse(data.discord_plan_expires_at) <= Date.now()));
        const verifiedUntil = data.discord_plan_expires_at ? Date.parse(data.discord_plan_expires_at) : 0;
        this.profileFreshUntil = Math.min(Date.now() + PROFILE_CACHE_MS,
            verifiedUntil > Date.now() ? verifiedUntil : Infinity);
    }

    private resetProfile(): void {
        ++this.profileRequest;
        this.profileLoad = null;
        this.profileFreshUntil = 0;
        this.discordCredential = null;
        this.profileSignal.set(null);
        this.discordReauthRequired.set(false);
    }

    private rememberOAuthProvider(provider: 'discord' | 'google'): void {
        this.discordCredential = null;
        // No credential or user data is stored here. This is routing context,
        // never proof of membership; resolve-plan still verifies the identity.
        sessionStorage.setItem(OAUTH_PROVIDER_KEY, JSON.stringify({ provider, startedAt: Date.now() }));
    }

    private consumeOAuthProvider(): 'discord' | 'google' | null {
        const stored = sessionStorage.getItem(OAUTH_PROVIDER_KEY);
        sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
        if (!stored) return null;
        try {
            const { provider, startedAt } = JSON.parse(stored);
            const age = Date.now() - startedAt;
            return (provider === 'discord' || provider === 'google') && age >= 0 && age < 15 * 60_000
                ? provider : null;
        } catch { return null; }
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
