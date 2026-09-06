import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BaseWidget } from 'gridstack/dist/angular';
import { EquityCurveGrouping } from '../../../core/utils/trade-stats.utils';
import { MarketEventsWidgetComponent } from '../../market-events/market-events-widget.component';
import { CalendarHeatmapComponent } from '../components/calendar-heatmap/calendar-heatmap.component';
import { GoalsWidgetComponent } from '../components/goals-widget/goals-widget.component';
import { PerformanceChartsComponent } from '../components/performance-charts/performance-charts.component';
import { RecentTradesComponent } from '../components/recent-trades/recent-trades.component';
import { StatsOverviewComponent } from '../components/stats-overview/stats-overview.component';
import { DashboardDataService } from '../dashboard-data.service';
import { DashboardWidgetFrameComponent } from './dashboard-widget-frame.component';

@Component({
    selector: 'app-dashboard-stats-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, StatsOverviewComponent],
    template: `
        <app-dashboard-widget-frame widgetId="stats" label="Performance stats">
            <app-stats-overview [stats]="data.stats()" />
        </app-dashboard-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardStatsWidgetComponent extends BaseWidget {
    readonly data = inject(DashboardDataService);
}

@Component({
    selector: 'app-dashboard-performance-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, PerformanceChartsComponent],
    template: `
        <app-dashboard-widget-frame widgetId="performance" label="Performance overview">
            <section class="performance-widget">
                <header class="performance-widget__header">
                    <h2>Performance overview</h2>
                    <div class="performance-widget__tabs" aria-label="Equity curve grouping">
                        @for (option of options; track option.value) {
                            <button type="button" [class.is-active]="view() === option.value"
                                (click)="view.set(option.value)">{{ option.label }}</button>
                        }
                    </div>
                </header>
                <app-performance-charts [equityData]="equityData()" [winLossStats]="data.stats()" />
            </section>
        </app-dashboard-widget-frame>
    `,
    styles: [`
        :host { display: block; height: 100%; min-height: 0; }
        .performance-widget {
            min-height: 100%; padding: 1.25rem 1.5rem; border: 1px solid var(--color-border);
            border-radius: 0.75rem; background: var(--color-bg-surface);
        }
        .performance-widget__header {
            display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
            margin-bottom: 1rem; flex-wrap: wrap;
        }
        .performance-widget__header h2 { margin: 0; color: var(--color-text-primary); font-size: 1rem; font-weight: 650; }
        .performance-widget__tabs { display: flex; gap: 0.25rem; padding: 0.25rem; border-radius: 0.5rem; background: var(--color-bg-surface-2); }
        .performance-widget__tabs button {
            padding: 0.25rem 0.7rem; border-radius: 0.35rem; color: var(--color-text-secondary);
            cursor: pointer; font-size: 0.75rem; font-weight: 550;
        }
        .performance-widget__tabs button:hover { color: var(--color-text-primary); }
        .performance-widget__tabs button.is-active { background: var(--color-bg-surface); color: var(--color-text-primary); }
        .performance-widget__tabs button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPerformanceWidgetComponent extends BaseWidget {
    readonly data = inject(DashboardDataService);
    readonly view = signal<EquityCurveGrouping>('hour');
    readonly options: ReadonlyArray<{ value: EquityCurveGrouping; label: string }> = [
        { value: 'trade', label: 'Trade' },
        { value: 'hour', label: 'Hour' },
        { value: 'day', label: 'Day' },
    ];
    readonly equityData = computed(() => this.data.equityCurve(this.view()));
}

@Component({
    selector: 'app-dashboard-calendar-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, CalendarHeatmapComponent],
    template: `
        <app-dashboard-widget-frame widgetId="calendar" label="Trading calendar">
            <app-calendar-heatmap [trades]="data.calendarTrades()" />
        </app-dashboard-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardCalendarWidgetComponent extends BaseWidget {
    readonly data = inject(DashboardDataService);
}

@Component({
    selector: 'app-dashboard-recent-trades-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, RecentTradesComponent],
    template: `
        <app-dashboard-widget-frame widgetId="recent-trades" label="Recent trades">
            <app-recent-trades [trades]="data.recentTrades()" />
        </app-dashboard-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRecentTradesWidgetComponent extends BaseWidget {
    readonly data = inject(DashboardDataService);
}

@Component({
    selector: 'app-dashboard-goals-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, GoalsWidgetComponent],
    template: `
        <app-dashboard-widget-frame widgetId="goals" label="Goals">
            <app-goals-widget />
        </app-dashboard-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardGoalsGridWidgetComponent extends BaseWidget {}

@Component({
    selector: 'app-dashboard-market-events-widget',
    standalone: true,
    host: { class: 'dashboard-grid-widget' },
    imports: [DashboardWidgetFrameComponent, MarketEventsWidgetComponent],
    template: `
        <app-dashboard-widget-frame widgetId="market-events" label="Market awareness">
            <app-market-events-widget />
        </app-dashboard-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardMarketEventsGridWidgetComponent extends BaseWidget {}

export const DASHBOARD_WIDGET_COMPONENTS = [
    DashboardStatsWidgetComponent,
    DashboardPerformanceWidgetComponent,
    DashboardCalendarWidgetComponent,
    DashboardRecentTradesWidgetComponent,
    DashboardGoalsGridWidgetComponent,
    DashboardMarketEventsGridWidgetComponent,
] as const;
