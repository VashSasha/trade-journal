import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

@Component({
    selector: 'app-landing-pricing',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-pricing.component.html',
    styleUrl: './landing-pricing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPricingComponent {
    readonly whopUrl = WHOP_URL;

    readonly journalFeatures: string[] = [
        'Tradovate auto-sync with FIFO trade matching',
        'Full analytics — equity curve, win rate, profit factor',
        'Daily journal, templates, tags & rule checklists',
        'AI-powered trade reports'
    ];

    readonly communityFeatures: string[] = [
        'Private NVZN Trading Discord community',
        'Live trade ideas from active traders',
        'Direct member support'
    ];
}
