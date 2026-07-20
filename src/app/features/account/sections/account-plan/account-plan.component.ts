import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountService } from '../../account.service';
import { BillingService, BillingInterval, BillingRecord } from '../../billing.service';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

/** Plan & billing: effective plan, its source, and Stripe subscribe / manage. */
@Component({
    selector: 'app-account-plan',
    standalone: true,
    imports: [RouterLink, TitleCasePipe, DatePipe],
    templateUrl: './account-plan.component.html',
    styleUrl: './account-plan.component.scss'
})
export class AccountPlanComponent implements OnInit {
    private auth = inject(AuthService);
    private account = inject(AccountService);
    private billing = inject(BillingService);

    readonly plan = this.auth.plan;
    readonly whopUrl = WHOP_URL;

    /** True for premium or lifetime. */
    readonly isPaid = computed(() => this.plan() === 'premium' || this.plan() === 'lifetime');

    private sources = signal<{ discord: string | null; billing: string | null; override: string | null }>(
        { discord: null, billing: null, override: null }
    );

    /** The caller's Stripe billing row, once loaded. */
    readonly billingRecord = signal<BillingRecord | null>(null);

    /** An active Stripe subscription backs this account (active or trialing). */
    readonly hasStripeSub = computed(() => {
        const s = this.billingRecord()?.status;
        return s === 'active' || s === 'trialing';
    });

    /** Currency-free reason we hide Subscribe: they're already premium via Discord. */
    readonly premiumViaDiscord = computed(() =>
        this.sources().discord === 'premium' || this.sources().discord === 'lifetime'
    );

    readonly checkoutBusy = signal<BillingInterval | null>(null);
    readonly portalBusy = signal(false);
    readonly billingError = signal<string | null>(null);

    /** Human label for where the effective plan comes from. */
    readonly sourceLabel = computed<string | null>(() => {
        const s = this.sources();
        if (s.override) return 'Granted (admin override)';
        const rank = (p: string | null) => (p === 'lifetime' ? 3 : p === 'premium' ? 2 : p === 'free' ? 1 : 0);
        if (rank(s.billing) >= 2 && rank(s.billing) >= rank(s.discord)) return 'Active subscription';
        if (rank(s.discord) >= 2) return 'Discord role';
        return null;
    });

    async ngOnInit(): Promise<void> {
        this.sources.set(await this.account.loadPlanSources());
        this.billingRecord.set(await this.billing.loadBilling());
    }

    async subscribe(interval: BillingInterval): Promise<void> {
        if (this.checkoutBusy()) return;
        this.billingError.set(null);
        this.checkoutBusy.set(interval);
        const { url, error } = await this.billing.startCheckout(interval);
        if (url) {
            window.location.assign(url);
            return; // navigating away — keep it busy
        }
        this.billingError.set(error ?? 'Could not start checkout.');
        this.checkoutBusy.set(null);
    }

    async manageSubscription(): Promise<void> {
        if (this.portalBusy()) return;
        this.billingError.set(null);
        this.portalBusy.set(true);
        const { url, error } = await this.billing.openPortal();
        if (url) {
            window.location.assign(url);
            return;
        }
        this.billingError.set(error ?? 'Could not open the billing portal.');
        this.portalBusy.set(false);
    }
}
