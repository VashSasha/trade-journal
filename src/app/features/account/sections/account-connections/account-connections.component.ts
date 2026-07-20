import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountService, LinkableProvider } from '../../account.service';

/**
 * Connected accounts: shows Discord / Google / email sign-in methods, links &
 * unlinks identities, and lets OAuth-only users add an email + password.
 */
@Component({
    selector: 'app-account-connections',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './account-connections.component.html',
    styleUrl: './account-connections.component.scss'
})
export class AccountConnectionsComponent {
    private account = inject(AccountService);
    private auth = inject(AuthService);

    readonly identities = this.account.identities;
    readonly loading = this.account.loadingIdentities;
    readonly hasEmailPassword = this.account.hasEmailPassword;

    /** Supabase forbids removing the last identity — used to disable unlink. */
    readonly isOnlyIdentity = computed(() => this.identities().length <= 1);

    busyProvider = signal<string | null>(null);
    linkError = signal<string | null>(null);

    // Add email/password (OAuth-only accounts).
    showEmailForm = signal(false);
    emailInput = signal('');
    passwordInput = signal('');
    emailBusy = signal(false);
    emailError = signal<string | null>(null);
    emailSuccess = signal(false);

    isConnected(provider: string): boolean {
        return this.account.hasProvider(provider);
    }

    async link(provider: LinkableProvider): Promise<void> {
        this.linkError.set(null);
        this.busyProvider.set(provider);
        // On success the browser redirects to the provider; only failures
        // before redirect resolve here.
        const { error } = await this.account.linkProvider(provider);
        if (error) {
            this.linkError.set(error);
            this.busyProvider.set(null);
        }
    }

    async unlink(provider: string): Promise<void> {
        if (this.isOnlyIdentity()) return;
        const identity = this.account.identityFor(provider);
        if (!identity) return;

        this.linkError.set(null);
        this.busyProvider.set(provider);
        const { error } = await this.account.unlink(identity);
        this.busyProvider.set(null);
        if (error) {
            this.linkError.set(error);
            return;
        }
        // Discord gone → clear its plan source so derived access updates.
        if (provider === 'discord') {
            try { await this.auth.clearDiscordPlan(); } catch { /* best-effort */ }
        }
    }

    async addEmailPassword(): Promise<void> {
        const password = this.passwordInput();
        if (password.length < 8) {
            this.emailError.set('Password must be at least 8 characters.');
            return;
        }
        this.emailBusy.set(true);
        this.emailError.set(null);
        const email = this.emailInput().trim() || undefined;
        const { error } = await this.account.addEmailPassword(email, password);
        this.emailBusy.set(false);
        if (error) {
            this.emailError.set(error);
            return;
        }
        this.emailSuccess.set(true);
        this.showEmailForm.set(false);
        this.passwordInput.set('');
        this.emailInput.set('');
    }
}
