import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    HostListener,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { EconomicCalendarService, EconomicEvent } from '../../core/services/economic-calendar.service';
import { economicEventTimestamp } from '../../core/utils/economic-events';
import { MarketEventAlertControlsComponent } from '../alerts/market-event-alert-controls.component';
import { sessionCountdown } from '../sessions/sessions.utils';
import { MarketNewsFeedComponent } from './market-news-feed.component';
import { MarketNewsService } from './market-news.service';
import { MarketPanelService, MarketPanelTab } from './market-panel.service';

const DAY_MS = 24 * 60 * 60 * 1000;

interface MarketEventGroup {
    key: string;
    label: string;
    events: EconomicEvent[];
}

@Component({
    selector: 'app-market-awareness-drawer',
    standalone: true,
    imports: [MarketEventAlertControlsComponent, MarketNewsFeedComponent],
    templateUrl: './market-awareness-drawer.component.html',
    styleUrl: './market-awareness-drawer.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketAwarenessDrawerComponent {
    readonly panel = inject(MarketPanelService);
    readonly calendar = inject(EconomicCalendarService);
    readonly news = inject(MarketNewsService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
    readonly now = signal(Date.now());
    readonly events = computed(() => this.calendar.getUpcomingEvents(this.now(), this.now() + 14 * DAY_MS));
    readonly groups = computed<MarketEventGroup[]>(() => {
        const groups = new Map<string, EconomicEvent[]>();
        for (const event of this.events()) {
            const date = new Date(economicEventTimestamp(event));
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            groups.set(key, [...(groups.get(key) ?? []), event]);
        }
        return [...groups.entries()].map(([key, events]) => ({
            key,
            label: this.dayLabel(economicEventTimestamp(events[0])),
            events,
        }));
    });
    readonly nextHighImpact = computed(() => this.events().find(event => event.impact === 'high') ?? null);
    readonly statusLabel = computed(() => {
        if (this.panel.activeTab() === 'alerts') return 'Sound and timing preferences';
        if (this.panel.activeTab() === 'news') {
            switch (this.news.status()) {
                case 'live': return 'Official headlines';
                case 'partial': return 'Partial official feed';
                case 'stale': return 'Cached headlines';
                case 'loading': return 'Updating headlines';
                case 'error': return 'Headlines unavailable';
                default: return 'Official headlines';
            }
        }
        switch (this.calendar.status()) {
            case 'live': return 'Official schedule';
            case 'stale': return 'Cached schedule';
            case 'loading': return 'Updating schedule';
            default: return 'Reference schedule';
        }
    });
    readonly refreshing = computed(() => this.panel.activeTab() === 'news'
        ? this.news.refreshing()
        : this.panel.activeTab() === 'calendar' && this.calendar.refreshing());
    readonly refreshLabel = computed(() => this.panel.activeTab() === 'news'
        ? 'Refresh market headlines'
        : 'Refresh market events');
    private readonly timer = window.setInterval(() => this.now.set(Date.now()), 30_000);

    constructor() {
        effect(() => {
            if (!this.panel.open()) return;
            window.setTimeout(() => this.closeButton()?.nativeElement.focus(), 0);
        });
        effect(() => {
            if (!this.panel.open()) return;
            if (this.panel.activeTab() === 'calendar') void this.calendar.refresh();
            if (this.panel.activeTab() === 'news') void this.news.refresh();
        });
        this.destroyRef.onDestroy(() => window.clearInterval(this.timer));
    }

    @HostListener('document:keydown.escape')
    closeOnEscape(): void {
        if (this.panel.open()) this.panel.close();
    }

    selectTab(tab: MarketPanelTab): void {
        this.panel.activeTab.set(tab);
    }

    refresh(): void {
        if (this.panel.activeTab() === 'calendar') void this.calendar.refresh(true);
        if (this.panel.activeTab() === 'news') void this.news.refresh(true);
    }

    timestamp(event: EconomicEvent): number {
        return economicEventTimestamp(event);
    }

    countdown(event: EconomicEvent): string {
        return sessionCountdown(this.timestamp(event) - this.now());
    }

    eventTime(event: EconomicEvent): string {
        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }).format(this.timestamp(event));
    }

    isImminent(event: EconomicEvent): boolean {
        return this.timestamp(event) - this.now() <= 60 * 60 * 1000;
    }

    private dayLabel(timestamp: number): string {
        const date = new Date(timestamp);
        const today = new Date(this.now());
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear()
            && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
        if (sameDay(date, today)) return 'Today';
        if (sameDay(date, tomorrow)) return 'Tomorrow';
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'long', month: 'short', day: 'numeric',
        }).format(date);
    }
}
