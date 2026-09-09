import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BaseWidget } from 'gridstack/dist/angular';
import { EquityCurveChartComponent } from '../../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { AnalyticsDataService } from '../analytics-data.service';
import { HourlyPerformanceComponent } from '../components/hourly-performance/hourly-performance.component';
import { LongShortBreakdownComponent } from '../components/long-short-breakdown/long-short-breakdown.component';
import { MonthlyPerformanceGridComponent } from '../components/monthly-performance-grid/monthly-performance-grid.component';
import { PerformanceBySetupComponent } from '../components/performance-by-setup/performance-by-setup.component';
import { PerformanceBySymbolComponent } from '../components/performance-by-symbol/performance-by-symbol.component';
import { PerformanceByWeekdayComponent } from '../components/performance-by-weekday/performance-by-weekday.component';
import { AnalyticsWidgetCardComponent } from './analytics-widget-card.component';
import { AnalyticsWidgetFrameComponent } from './analytics-widget-frame.component';

@Component({
    selector: 'app-analytics-equity-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, EquityCurveChartComponent],
    template: `
        <app-analytics-widget-card widgetId="equity" title="Combined equity curve"
            meta="All selected account P&amp;L">
            <div class="analytics-equity-widget__chart">
                <app-equity-curve-chart [equityData]="data.equityCurveData()"
                    [baseline]="data.equityBaseline()" />
            </div>
        </app-analytics-widget-card>
    `,
    styles: [`
        .analytics-equity-widget__chart { height: 300px; }
        @media (max-width: 560px) { .analytics-equity-widget__chart { height: 240px; } }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsEquityWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-long-short-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, LongShortBreakdownComponent],
    template: `
        <app-analytics-widget-card widgetId="long-short" title="Long vs short"
            [meta]="'By ' + data.unitLabel()">
            <app-long-short-breakdown [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-card>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsLongShortWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-monthly-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetFrameComponent, MonthlyPerformanceGridComponent],
    template: `
        <app-analytics-widget-frame widgetId="monthly" label="Monthly performance">
            <app-monthly-performance-grid [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-frame>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsMonthlyWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-symbol-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, PerformanceBySymbolComponent],
    template: `
        <app-analytics-widget-card widgetId="symbol" title="Performance by symbol"
            [meta]="'By ' + data.unitLabel()">
            <app-performance-by-symbol [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-card>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsSymbolWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-weekday-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, PerformanceByWeekdayComponent],
    template: `
        <app-analytics-widget-card widgetId="weekday" title="Performance by trading day"
            [meta]="'By ' + data.unitLabel()">
            <app-performance-by-weekday [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-card>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsWeekdayWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-hourly-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, HourlyPerformanceComponent],
    template: `
        <app-analytics-widget-card widgetId="hourly" title="Performance by entry hour"
            [meta]="'By ' + data.unitLabel()">
            <app-hourly-performance [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-card>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsHourlyWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

@Component({
    selector: 'app-analytics-setup-widget',
    standalone: true,
    host: { class: 'analytics-grid-widget' },
    imports: [AnalyticsWidgetCardComponent, PerformanceBySetupComponent],
    template: `
        <app-analytics-widget-card widgetId="setup" title="Performance by setup"
            [meta]="'By ' + data.unitLabel()">
            <app-performance-by-setup [trades]="data.filteredTrades()" [unit]="data.unit()" />
        </app-analytics-widget-card>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsSetupWidgetComponent extends BaseWidget {
    readonly data = inject(AnalyticsDataService);
}

export const ANALYTICS_WIDGET_COMPONENTS = [
    AnalyticsEquityWidgetComponent,
    AnalyticsLongShortWidgetComponent,
    AnalyticsMonthlyWidgetComponent,
    AnalyticsSymbolWidgetComponent,
    AnalyticsWeekdayWidgetComponent,
    AnalyticsHourlyWidgetComponent,
    AnalyticsSetupWidgetComponent,
] as const;
