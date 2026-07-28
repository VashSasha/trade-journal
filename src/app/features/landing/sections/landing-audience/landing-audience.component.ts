import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

interface AudienceCard {
    icon: string;
    title: string;
    text: string;
}

@Component({
    selector: 'app-landing-audience',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-audience.component.html',
    styleUrl: './landing-audience.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingAudienceComponent {
    readonly cards: AudienceCard[] = [
        {
            icon: '🧭',
            title: 'Still finding your edge',
            text: 'Journal every session without the data entry, and let the AI coach point out the mistakes you keep repeating — before they become habits.'
        },
        {
            icon: '📈',
            title: 'Consistent and scaling',
            text: 'Track multiple accounts side by side and keep your discipline honest as size grows. The AI review after each session tells you when execution starts slipping.'
        },
        {
            icon: '🏁',
            title: 'Prop-firm challenge traders',
            text: 'Evaluation and funded accounts tracked separately, with real fees. Use the daily AI insight to catch rule breaks early — before they cost you the account.'
        }
    ];
}
