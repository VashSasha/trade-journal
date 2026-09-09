import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AnalyticsWidgetId } from '../analytics-layout.model';
import { AnalyticsWidgetFrameComponent } from './analytics-widget-frame.component';

@Component({
    selector: 'app-analytics-widget-card',
    standalone: true,
    imports: [AnalyticsWidgetFrameComponent],
    templateUrl: './analytics-widget-card.component.html',
    styleUrl: './analytics-widget-card.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsWidgetCardComponent {
    readonly widgetId = input.required<AnalyticsWidgetId>();
    readonly title = input.required<string>();
    readonly meta = input.required<string>();
}
