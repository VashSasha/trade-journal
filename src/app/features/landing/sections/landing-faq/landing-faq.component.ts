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
            answer: 'Tradovate today, including supported prop-firm accounts using Tradovate. Sync broker reports or import a Tradovate Performance CSV. Fees use reported values where available, or your configured commission. More brokers are on the roadmap.'
        },
        {
            question: 'How does the AI coaching work?',
            answer: 'Premium+ adds Live Coach, saved daily reviews and chart analysis. Set your guardrails for timely spoken or on-screen reminders, review a short daily summary, then ask for more detail. AI requests and voices have daily limits. AI can make mistakes; use it to support your review, not to make trading decisions for you.'
        },
        {
            question: 'Does Live Coach place trades or run while NVZN is closed?',
            answer: 'No. Live Coach never places orders. Live monitoring needs NVZN open and your broker connected. Open-position P&L alerts also require fresh quotes and available API market data. You can turn voice off and keep the on-screen context.'
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
