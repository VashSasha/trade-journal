import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';
const NVZN_TRADING_URL = 'https://nvzntrading.com/';

interface DiscordPillar {
    icon: string;
    title: string;
    text: string;
}

@Component({
    selector: 'app-landing-discord',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-discord.component.html',
    styleUrl: './landing-discord.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingDiscordComponent {
    readonly whopUrl = WHOP_URL;
    readonly nvznTradingUrl = NVZN_TRADING_URL;

    readonly pillars: DiscordPillar[] = [
        {
            icon: '📺',
            title: 'Live Trading Rooms',
            text: 'Watch the framework applied in real time — screen-shared charts, called levels, and full transparency on entries, stops, and targets. Wins and losses alike.'
        },
        {
            icon: '📐',
            title: 'Structured Framework',
            text: 'One set of rules for execution, entries, stops, and targets, so you trade the plan instead of your emotions.'
        },
        {
            icon: '🤝',
            title: 'A Community That Trades',
            text: 'Daily watchlists, trade reviews, and accountability from traders running the same playbook. Your setups get sharper when a thousand eyes trade the same levels.'
        }
    ];
}
