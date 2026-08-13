import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AuthService } from '../../../core/services/auth.service';
import { BillingService } from '../../account/billing.service';

type Reason = 'connect' | 'save' | 'sync' | 'ai';

const COPY: Record<Reason, { title: string; body: string }> = {
    connect: {
        title: 'Connect your broker to journal your real trades',
        body: 'Link your Tradovate account to start tracking actual trades, P&L, and get personalized AI coaching on your real performance.',
    },
    save: {
        title: 'Create an account to save your work',
        body: 'Your edits live in this demo session only. Subscribe to keep your journal entries, templates, and custom rules.',
    },
    sync: {
        title: 'Sync your real trades',
        body: 'Pull your live trading data from Tradovate to build a journal backed by your actual performance history.',
    },
    ai: {
        title: 'Get AI coaching on your own trades',
        body: 'AI coaching is powered by your real trade history. Subscribe to unlock personalized analysis and daily accountability.',
    },
};

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

@Component({
    selector: 'app-upgrade-prompt',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './upgrade-prompt.component.html',
    styleUrl: './upgrade-prompt.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpgradePromptComponent {
    readonly demo = inject(DemoModeService);
    private auth = inject(AuthService);
    private billing = inject(BillingService);

    readonly visible = computed(() => this.demo.promptReason() !== null);
    readonly copy = computed(() => {
        const r = this.demo.promptReason();
        return r ? COPY[r] : null;
    });
    readonly isSignedIn = computed(() => !!this.auth.currentUser());

    readonly whopUrl = WHOP_URL;

    dismiss(): void {
        this.demo.dismissPrompt();
    }

    async subscribe(): Promise<void> {
        const { url } = await this.billing.startCheckout('monthly');
        if (url) window.location.href = url;
    }
}
