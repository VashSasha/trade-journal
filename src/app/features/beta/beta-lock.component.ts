import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { BillingService, BillingInterval } from '../account/billing.service';

/**
 * Standalone "closed beta" screen shown to authenticated users who don't yet
 * have access (no beta role AND no paid plan). Rendered outside the app shell
 * (no sidebar / header) — see the `/beta` route.
 *
 * Offers the two real ways to gain access: join NVZN Trading (Whop → Discord
 * role), or subscribe to the journal directly (Stripe). Paying here flips the
 * user's plan via the webhook, and the beta guard lets any paid plan through,
 * so checkout is not itself blocked by the gate.
 */
@Component({
    selector: 'app-beta-lock',
    standalone: true,
    templateUrl: './beta-lock.component.html',
    styleUrl: './beta-lock.component.scss'
})
export class BetaLockComponent {
    private authService = inject(AuthService);
    private router = inject(Router);
    private billing = inject(BillingService);

    /** Whop membership — grants the Discord role that unlocks access. */
    readonly whopJoinUrl = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

    readonly checkoutLoading = signal<BillingInterval | null>(null);
    readonly checkoutError = signal<string | null>(null);

    async subscribe(interval: BillingInterval): Promise<void> {
        this.checkoutError.set(null);
        this.checkoutLoading.set(interval);
        const { url, error } = await this.billing.startCheckout(interval);
        if (url) {
            window.location.href = url;
            return;
        }
        this.checkoutError.set(error ?? 'Could not start checkout. Please try again.');
        this.checkoutLoading.set(null);
    }

    logout(): void {
        this.authService.logout();
        this.router.navigate(['/login']);
    }
}
