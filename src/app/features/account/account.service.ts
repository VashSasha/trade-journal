import { Injectable, computed, inject, signal } from '@angular/core';
import { UserIdentity } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';

export type LinkableProvider = 'discord' | 'google';

/**
 * Account-scoped operations: profile edits and identity/account linking.
 * Wraps the Supabase auth + `profiles` calls the Account page needs and holds
 * the shared identity list so its sections stay in sync. Provided by the
 * Account page (scoped), not root.
 */
@Injectable()
export class AccountService {
    private supabase = inject(SupabaseService).client;
    private auth = inject(AuthService);

    /** The signed-in user's linked identities (Discord / Google / email). */
    readonly identities = signal<UserIdentity[]>([]);
    readonly loadingIdentities = signal(false);

    /** True once the user has an email/password identity (can sign in with a password). */
    readonly hasEmailPassword = computed(() => this.hasProvider('email'));

    // ── identities ────────────────────────────────────────────────────────

    async loadIdentities(): Promise<void> {
        this.loadingIdentities.set(true);
        const { data, error } = await this.supabase.auth.getUserIdentities();
        this.loadingIdentities.set(false);
        this.identities.set(error || !data ? [] : data.identities);
    }

    hasProvider(provider: string): boolean {
        return this.identities().some(i => i.provider === provider);
    }

    identityFor(provider: string): UserIdentity | undefined {
        return this.identities().find(i => i.provider === provider);
    }

    // ── profile ─────────────────────────────────────────────────────────────

    /**
     * Persist a new display name to `profiles` (RLS/column-grant allow only
     * this column) and mirror it into auth metadata so the app-wide name
     * (sidebar, etc.) updates immediately.
     */
    async updateDisplayName(name: string): Promise<void> {
        const uid = this.auth.session()?.user.id;
        if (!uid) throw new Error('You are not signed in.');

        const { error: profileError } = await this.supabase
            .from('profiles')
            .update({ display_name: name })
            .eq('id', uid);
        if (profileError) throw new Error(profileError.message);

        const { error: metaError } = await this.supabase.auth.updateUser({ data: { full_name: name } });
        if (metaError) throw new Error(metaError.message);
    }

    /**
     * Read the individual plan SOURCE columns for display ("where your plan
     * comes from"). Owner-readable via select-own RLS; the effective plan
     * itself is derived server-side (0007).
     */
    async loadPlanSources(): Promise<{ discord: string | null; billing: string | null; override: string | null }> {
        const uid = this.auth.session()?.user.id;
        if (!uid) return { discord: null, billing: null, override: null };
        const { data } = await this.supabase
            .from('profiles')
            .select('discord_plan, billing_plan, plan_override')
            .eq('id', uid)
            .single();
        return {
            discord: data?.discord_plan ?? null,
            billing: data?.billing_plan ?? null,
            override: data?.plan_override ?? null,
        };
    }

    // ── linking ───────────────────────────────────────────────────────────

    /**
     * Begin linking an OAuth provider to the current account. This redirects
     * the browser to the provider and returns to /account?linked=<provider>,
     * where the page finalizes (and, for Discord, re-resolves the plan).
     * Only resolves (with an error) if it fails before the redirect.
     */
    async linkProvider(provider: LinkableProvider): Promise<{ error?: string }> {
        const redirectTo = new URL('/account', window.location.origin);
        redirectTo.searchParams.set('linked', provider);

        const options: { redirectTo: string; scopes?: string } = { redirectTo: redirectTo.toString() };
        if (provider === 'discord') options.scopes = 'identify email guilds.members.read';

        const { error } = await this.supabase.auth.linkIdentity({ provider, options });
        if (error) return { error: this.friendlyLinkError(provider, error.message) };
        return {};
    }

    /** Add an email + password to an OAuth-only account (optionally set/confirm email). */
    async addEmailPassword(email: string | undefined, password: string): Promise<{ error?: string }> {
        const payload: { password: string; email?: string } = { password };
        if (email) payload.email = email;
        const { error } = await this.supabase.auth.updateUser(payload);
        if (error) return { error: error.message };
        await this.loadIdentities();
        return {};
    }

    /** Remove a linked identity. Supabase forbids removing the last one. */
    async unlink(identity: UserIdentity): Promise<{ error?: string }> {
        const { error } = await this.supabase.auth.unlinkIdentity(identity);
        if (error) return { error: error.message };
        await this.loadIdentities();
        return {};
    }

    /**
     * Map raw linking errors to friendly copy. The common case is a provider
     * account already bound to a DIFFERENT NVZN account — we never merge.
     */
    private friendlyLinkError(provider: LinkableProvider, message: string): string {
        const label = provider === 'discord' ? 'Discord' : 'Google';
        if (/already|exists|registered|linked|in use|identity_already/i.test(message)) {
            return `That ${label} account is already linked to another NVZN account.`;
        }
        if (/manual linking|not enabled|disabled/i.test(message)) {
            return 'Account linking is temporarily unavailable. Please try again later.';
        }
        return message || `Couldn't link ${label}. Please try again.`;
    }

    // ── danger zone ─────────────────────────────────────────────────────────

    async signOutEverywhere(): Promise<void> {
        await this.supabase.auth.signOut({ scope: 'global' });
    }

    /** Invoke the delete-account Edge Function (deletes the caller's own user). */
    async deleteAccount(): Promise<{ error?: string }> {
        const { error } = await this.supabase.functions.invoke('delete-account', { body: {} });
        if (error) {
            const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
            return { error: body?.error || 'Failed to delete account. Please try again.' };
        }
        return {};
    }
}
