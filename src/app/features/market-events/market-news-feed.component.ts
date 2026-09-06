import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { MarketHeadline, MarketHeadlineCategory } from './market-news.models';
import { MarketNewsService } from './market-news.service';

type HeadlineFilter = 'all' | MarketHeadlineCategory;
const NEWS_REFRESH_MS = 15 * 60 * 1000;

interface FilterOption {
    value: HeadlineFilter;
    label: string;
}

@Component({
    selector: 'app-market-news-feed',
    standalone: true,
    templateUrl: './market-news-feed.component.html',
    styleUrl: './market-news-feed.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketNewsFeedComponent {
    readonly news = inject(MarketNewsService);
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    readonly filter = signal<HeadlineFilter>('all');
    readonly now = signal(Date.now());
    readonly filters: FilterOption[] = [
        { value: 'all', label: 'All' },
        { value: 'monetary-policy', label: 'Fed' },
        { value: 'inflation', label: 'Inflation' },
        { value: 'employment', label: 'Jobs' },
    ];
    readonly visibleHeadlines = computed(() => {
        const filter = this.filter();
        return this.news.headlines().filter(headline => filter === 'all' || headline.category === filter);
    });
    readonly emptyTitle = computed(() => {
        const filter = this.filter();
        return filter === 'all' ? 'No headlines yet.' : `No ${this.categoryLabel(filter).toLowerCase()} headlines yet.`;
    });
    private readonly timer = this.document.defaultView?.setInterval(() => this.now.set(Date.now()), 60_000);
    private readonly refreshTimer = this.document.defaultView?.setInterval(
        () => void this.news.refresh(), NEWS_REFRESH_MS,
    );

    constructor() {
        void this.news.refresh();
        this.destroyRef.onDestroy(() => {
            this.document.defaultView?.clearInterval(this.timer);
            this.document.defaultView?.clearInterval(this.refreshTimer);
        });
    }

    selectFilter(filter: HeadlineFilter): void {
        this.filter.set(filter);
    }

    filterCount(filter: HeadlineFilter): number {
        return filter === 'all'
            ? this.news.headlines().length
            : this.news.headlines().filter(headline => headline.category === filter).length;
    }

    sourceLabel(headline: MarketHeadline): string {
        switch (headline.source) {
            case 'federal-reserve': return 'Federal Reserve';
            case 'bls-cpi': return 'BLS · CPI';
            case 'bls-employment': return 'BLS · Jobs';
            case 'bls-ppi': return 'BLS · PPI';
        }
    }

    categoryLabel(category: MarketHeadlineCategory): string {
        switch (category) {
            case 'monetary-policy': return 'Policy';
            case 'inflation': return 'Inflation';
            case 'employment': return 'Employment';
        }
    }

    relativeTime(headline: MarketHeadline): string {
        const difference = Date.parse(headline.publishedAt) - this.now();
        const absolute = Math.abs(difference);
        if (absolute < 60_000) return 'Just now';
        const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        if (absolute < 60 * 60_000) return formatter.format(Math.round(difference / 60_000), 'minute');
        if (absolute < 24 * 60 * 60_000) return formatter.format(Math.round(difference / (60 * 60_000)), 'hour');
        return formatter.format(Math.round(difference / (24 * 60 * 60_000)), 'day');
    }

    exactTime(headline: MarketHeadline): string {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
            timeZoneName: 'short',
        }).format(Date.parse(headline.publishedAt));
    }

    isRecent(headline: MarketHeadline): boolean {
        const age = this.now() - Date.parse(headline.publishedAt);
        return age >= 0 && age <= 6 * 60 * 60_000;
    }

    retry(): void {
        void this.news.refresh(true);
    }
}
