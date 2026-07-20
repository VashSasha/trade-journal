import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountService } from '../../account.service';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

/** Plan & billing: effective plan, its source, and upgrade / manage links. */
@Component({
    selector: 'app-account-plan',
    standalone: true,
    imports: [RouterLink, TitleCasePipe],
    templateUrl: './account-plan.component.html',
    styleUrl: './account-plan.component.scss'
})
export class AccountPlanComponent implements OnInit {
    private auth = inject(AuthService);
    private account = inject(AccountService);

    readonly plan = this.auth.plan;
    readonly whopUrl = WHOP_URL;

    /** True for premium or lifetime. */
    readonly isPaid = computed(() => this.plan() === 'premium' || this.plan() === 'lifetime');

    private sources = signal<{ discord: string | null; billing: string | null; override: string | null }>(
        { discord: null, billing: null, override: null }
    );

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
    }
}
