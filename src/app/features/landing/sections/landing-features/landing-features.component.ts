import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

interface FeatureCard {
    icon: 'sync' | 'journal' | 'analytics' | 'calendar' | 'ai' | 'news';
    title: string;
    description: string;
}

@Component({
    selector: 'app-landing-features',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-features.component.html',
    styleUrl: './landing-features.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFeaturesComponent {
    readonly features: FeatureCard[] = [
        {
            icon: 'sync',
            title: 'Tradovate auto-sync',
            description: 'Connect your broker once. Fills are pulled automatically and matched into complete trades with FIFO — no manual entry, no CSV wrangling.'
        },
        {
            icon: 'analytics',
            title: 'Analytics that matter',
            description: 'Equity curve, win rate, profit factor, drawdown, and per-symbol breakdowns — computed live from your real trade history.'
        },
        {
            icon: 'journal',
            title: 'Daily journal',
            description: 'Rich-text notes, mood and discipline tracking, rule checklists, templates, and tags. Build the review habit that separates pros from gamblers.'
        },
        {
            icon: 'calendar',
            title: 'P&L calendar',
            description: 'A heatmap of every trading day. Spot your best weekdays, your worst streaks, and the patterns hiding in your month at a glance.'
        },
        {
            icon: 'ai',
            title: 'AI trade reports',
            description: 'Let AI read your trade history and journal entries, then hand you a report on what is working, what is bleeding money, and what to change.'
        },
        {
            icon: 'news',
            title: 'Economic calendar',
            description: 'High-impact events surfaced right inside your journal, so you always know whether that loss was you — or CPI.'
        }
    ];
}
