import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AuthService } from '../../../core/services/auth.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';

type Reason = 'connect' | 'save' | 'sync' | 'ai';

const COPY: Record<Reason, { title: string; body: string }> = {
    connect: {
        title: 'Connect your broker to journal your real trades',
        body: 'Premium connects your broker to track actual trades and P&L. Premium+ adds personalized AI coaching.',
    },
    save: {
        title: 'Save in your own journal',
        body: 'Demo edits are not saved or copied into your account. Manual trades and basic daily journaling are free in your own workspace.',
    },
    sync: {
        title: 'Sync your real trades',
        body: 'Pull your live trading data from Tradovate to build a journal backed by your actual performance history.',
    },
    ai: {
        title: 'Get AI coaching on your own trades',
        body: 'Premium+ adds personalized analysis, AI voices and coaching based on your real trading history.',
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
    readonly access = inject(AccessPolicyService);
    readonly canSwitch = computed(() => this.isSignedIn() && this.demo.active() && (this.demo.promptReason() === 'ai' ? this.access.ai() : this.access.paid() || this.demo.promptReason() === 'save'));

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

    async switchWorkspace(): Promise<void> {
        const reason = this.demo.promptReason();
        await this.demo.exit(reason === 'connect' || reason === 'sync' ? '/account/integrations' : '/dashboard');
    }
}
