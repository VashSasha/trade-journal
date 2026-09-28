import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

const WHOP_URL = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';
const NVZN_TRADING_URL = 'https://nvzntrading.com/';

interface DiscordPillar {
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
            title: 'Live Trading Rooms',
            text: 'See the trading framework in context through shared charts and live discussion. Bring your own questions back to the journal.'
        },
        {
            title: 'Structured Framework',
            text: 'Discuss setups, entries and risk with a shared vocabulary. Use your journal to reflect on how you followed your own plan.'
        },
        {
            title: 'A Community That Trades',
            text: 'Exchange trade reviews and perspectives with other members. A place for the conversation around the numbers.'
        }
    ];
}
