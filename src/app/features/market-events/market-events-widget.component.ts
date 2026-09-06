import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { EconomicCalendarService, EconomicEvent } from '../../core/services/economic-calendar.service';
import { economicEventTimestamp } from '../../core/utils/economic-events';
import { sessionCountdown } from '../sessions/sessions.utils';

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
    selector: 'app-market-events-widget',
    standalone: true,
    templateUrl: './market-events-widget.component.html',
    styleUrl: './market-events-widget.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketEventsWidgetComponent {
    readonly calendar = inject(EconomicCalendarService);
    private readonly destroyRef = inject(DestroyRef);
    readonly now = signal(Date.now());
    readonly events = computed(() => this.calendar.getUpcomingEvents(this.now(), this.now() + 14 * DAY_MS).slice(0, 6));
    readonly nextHigh = computed(() => this.events().find(event => event.impact === 'high') ?? null);
    readonly statusLabel = computed(() => {
        switch (this.calendar.status()) {
            case 'live': return 'Official schedule';
            case 'stale': return 'Cached schedule';
            case 'loading': return 'Updating';
            default: return 'Reference schedule';
        }
    });
    private readonly timer = window.setInterval(() => this.now.set(Date.now()), 30_000);

    constructor() {
        this.destroyRef.onDestroy(() => window.clearInterval(this.timer));
    }

    timestamp(event: EconomicEvent): number { return economicEventTimestamp(event); }

    countdown(event: EconomicEvent): string {
        return sessionCountdown(this.timestamp(event) - this.now());
    }

    eventTime(event: EconomicEvent): string {
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            timeZoneName: 'short',
        }).format(this.timestamp(event));
    }

    isImminent(event: EconomicEvent): boolean {
        return this.timestamp(event) - this.now() <= 60 * 60 * 1000;
    }

    refresh(): void { void this.calendar.refresh(true); }
}
