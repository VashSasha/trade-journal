import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

interface FaqItem {
    question: string;
    answer: string;
}

@Component({
    selector: 'app-landing-faq',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-faq.component.html',
    styleUrl: './landing-faq.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFaqComponent {
    readonly items: FaqItem[] = [
        {
            question: 'Do I need the Discord membership?',
            answer: 'No. NVZN Trading members get plan-based access automatically when they log in with Discord, but there is also a journal-only subscription — choose Premium for the journal and analytics, or Premium+ for AI features. Community membership includes Premium; AI is separate.'
        },
        {
            question: 'Which brokers are supported?',
            answer: 'Tradovate today — fills, accounts, and fees sync automatically, including prop-firm accounts running on Tradovate infrastructure. More brokers are on the roadmap.'
        },
        {
            question: 'How does the AI coaching work?',
            answer: 'With Premium+ or an individual AI access grant, you generate an insight from your daily journal: the AI reads that day\'s actual trades — P&L, win rate, win/loss dynamics — and returns a summary, key takeaways, and a checklist of action points for tomorrow. You can also upload a chart screenshot on the Reports page and get a structured verdict with levels and confidence, then ask follow-up questions. Everything runs server-side; there are no API keys to manage.'
        },
        {
            question: 'Is my data safe?',
            answer: 'Your trades and journal entries are stored in your own account with owner-scoped access rules — no other user can read them. AI analysis runs server-side. The necessary trade summary and any images you submit are sent to our AI provider to generate your response.'
        },
        {
            question: 'Can I cancel anytime?',
            answer: 'Yes. The journal-only subscription is managed through a self-serve billing portal — cancel anytime and you keep access until the end of the paid period. Membership-based access follows your NVZN Trading membership.'
        }
    ];
}
