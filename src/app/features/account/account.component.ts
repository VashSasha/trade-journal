import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AccessPolicyService, PaidFeature } from '../../core/services/access-policy.service';
import { AccountService } from './account.service';

interface SettingsLink {
    path: string;
    label: string;
    detail: string;
    feature?: PaidFeature;
}

/**
 * Route-backed settings shell. The internal rail scales independently from
 * the main product navigation while each section remains self-contained.
 */
@Component({
    selector: 'app-account',
    standalone: true,
    imports: [RouterLink, RouterLinkActive, RouterOutlet],
    providers: [AccountService],
    templateUrl: './account.component.html',
    styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit {
    private account = inject(AccountService);
    private auth = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    readonly access = inject(AccessPolicyService);

    /** Transient toast for post-Checkout redirects. */
    readonly toast = signal<{ kind: 'success' | 'info'; text: string } | null>(null);

    readonly personalLinks: readonly SettingsLink[] = [
        { path: 'profile', label: 'Profile', detail: 'Name and account details' },
        { path: 'sign-in', label: 'Sign-in methods', detail: 'Google, Discord and email' },
        { path: 'plan', label: 'Plan & billing', detail: 'Membership and subscription' },
    ];

    readonly workspaceLinks: readonly SettingsLink[] = [
        { path: 'integrations', label: 'Broker connections', detail: 'Accounts, sync and imports', feature: 'broker' },
        { path: 'alerts', label: 'Alerts', detail: 'Session bells and guardrails' },
        { path: 'appearance', label: 'Appearance', detail: 'Theme and display' },
        { path: 'data', label: 'Account data', detail: 'Sessions and account removal' },
    ];

    async ngOnInit(): Promise<void> {
        await this.auth.authReady;
        await this.account.loadIdentities();

        // Handle old and current Stripe returns from any Settings child.
        const checkout = this.route.snapshot.queryParamMap.get('checkout');
        if (checkout === 'success' || checkout === 'cancel') {
            this.showToast(
                checkout === 'success' ? 'success' : 'info',
                checkout === 'success' ? 'Subscription active!' : 'Checkout canceled.',
            );
            // The webhook may have already flipped the plan — pick it up.
            if (checkout === 'success') await this.auth.refreshProfile({ force: true });
            this.clearQueryParams('/account/plan');
            return;
        }

        // Finalize a linkIdentity() redirect (…/account?linked=discord|google).
        const linked = this.route.snapshot.queryParamMap.get('linked');
        if (!linked) return;

        try { await this.auth.completeOAuth(linked); } catch { /* best-effort; plan can re-resolve later */ }

        await this.account.loadIdentities();
        await this.auth.refreshProfile();
        this.clearQueryParams('/account/sign-in');
    }

    private showToast(kind: 'success' | 'info', text: string): void {
        this.toast.set({ kind, text });
        setTimeout(() => this.toast.set(null), 5000);
    }

    /** Drop one-shot query params so a reload doesn't re-run the handlers. */
    private clearQueryParams(destination: string): void {
        void this.router.navigateByUrl(destination, { replaceUrl: true });
    }
}
