import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AccountService } from './account.service';
import { AccountProfileComponent } from './sections/account-profile/account-profile.component';
import { AccountConnectionsComponent } from './sections/account-connections/account-connections.component';
import { AccountPlanComponent } from './sections/account-plan/account-plan.component';
import { AccountAppearanceComponent } from './sections/account-appearance/account-appearance.component';
import { AccountDangerComponent } from './sections/account-danger/account-danger.component';

/**
 * Account settings shell. Provides the scoped AccountService and stacks the
 * self-contained sections. Also finalizes account-link redirects that return
 * to /account?linked=<provider>.
 */
@Component({
    selector: 'app-account',
    standalone: true,
    imports: [
        AccountProfileComponent,
        AccountConnectionsComponent,
        AccountPlanComponent,
        AccountAppearanceComponent,
        AccountDangerComponent,
    ],
    providers: [AccountService],
    templateUrl: './account.component.html',
    styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit {
    private account = inject(AccountService);
    private auth = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    /** Transient toast for post-Checkout redirects. */
    readonly toast = signal<{ kind: 'success' | 'info'; text: string } | null>(null);

    async ngOnInit(): Promise<void> {
        await this.auth.authReady;
        await this.account.loadIdentities();

        // Handle a Stripe Checkout return (…/account?checkout=success|cancel).
        const checkout = this.route.snapshot.queryParamMap.get('checkout');
        if (checkout === 'success' || checkout === 'cancel') {
            this.showToast(
                checkout === 'success' ? 'success' : 'info',
                checkout === 'success' ? 'Subscription active!' : 'Checkout canceled.',
            );
            // The webhook may have already flipped the plan — pick it up.
            if (checkout === 'success') await this.auth.refreshProfile();
            this.clearQueryParams();
            return;
        }

        // Finalize a linkIdentity() redirect (…/account?linked=discord|google).
        const linked = this.route.snapshot.queryParamMap.get('linked');
        if (!linked) return;

        // Discord roles gate the plan — re-resolve now that it's linked. The
        // provider_token in the fresh session is Discord's right after linking.
        if (linked === 'discord') {
            const token = this.auth.session()?.provider_token;
            if (token) {
                try { await this.auth.resolvePlan(token); } catch { /* best-effort; plan can re-resolve later */ }
            }
        }

        await this.account.loadIdentities();
        await this.auth.refreshProfile();
        this.clearQueryParams();
    }

    private showToast(kind: 'success' | 'info', text: string): void {
        this.toast.set({ kind, text });
        setTimeout(() => this.toast.set(null), 5000);
    }

    /** Drop one-shot query params so a reload doesn't re-run the handlers. */
    private clearQueryParams(): void {
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
}
