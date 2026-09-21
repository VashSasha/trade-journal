import { Component, ElementRef, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountService } from '../../account.service';
import { BillingService, BillingRecord } from '../../billing.service';

import { isPaidPlan, planLabel, planRank } from '../../../../core/models/user.model';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

/** Plan & billing: effective plan, its source, and Stripe subscribe / manage. */
@Component({
    selector: 'app-account-plan',
    standalone: true,
    imports: [RouterLink, DatePipe],
    templateUrl: './account-plan.component.html',
    styleUrl: './account-plan.component.scss'
})
export class AccountPlanComponent implements OnInit {
    private auth = inject(AuthService);
    private account = inject(AccountService);
    private billing = inject(BillingService);

    readonly plan = this.auth.plan;
    readonly planLabel = planLabel;
    readonly aiAccess = this.auth.aiAccess;
    readonly discordReauthRequired = this.auth.discordReauthRequired;

    constructor() {
        const host = inject(ElementRef<HTMLElement>);
        const route = inject(ActivatedRoute);
        // The workspace scrolls inside .app-content, not the browser window.
        // Restore the billing section when returning from the pricing page.
        afterNextRender(() => {
            if (route.snapshot.fragment === 'billing') {
                host.nativeElement.scrollIntoView({ block: 'start' });
            }
        });
    }

    async refreshDiscord(): Promise<void> {
        try { await this.auth.loginWithDiscord('/account/plan'); }
        catch { this.billingError.set('Could not open Discord sign-in. Please try again.'); }
    }
    readonly whopUrl = WHOP_URL;

    readonly isPaid = computed(() => isPaidPlan(this.plan()));

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
        isPaidPlan(this.sources().discord)
    );

    readonly portalBusy = signal(false);
    readonly billingError = signal<string | null>(null);

    /** Human label for where the effective plan comes from. */
    readonly sourceLabel = computed<string | null>(() => {
        const s = this.sources();
        if (s.override) return 'Granted (admin override)';
        const rank = planRank;
        if (rank(s.billing) >= 2 && rank(s.billing) >= rank(s.discord)) return 'Active subscription';
        if (rank(s.discord) >= 2) return 'Discord role';
        return null;
    });

    async ngOnInit(): Promise<void> {
        this.sources.set(await this.account.loadPlanSources());
        this.billingRecord.set(await this.billing.loadBilling());
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
