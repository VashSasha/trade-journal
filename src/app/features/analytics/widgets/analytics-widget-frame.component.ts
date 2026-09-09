import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { AnalyticsWidgetId } from '../analytics-layout.model';
import { AnalyticsLayoutService } from '../analytics-layout.service';

@Component({
    selector: 'app-analytics-widget-frame',
    standalone: true,
    templateUrl: './analytics-widget-frame.component.html',
    styleUrl: './analytics-widget-frame.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsWidgetFrameComponent {
    readonly widgetId = input.required<AnalyticsWidgetId>();
    readonly label = input.required<string>();
    readonly layout = inject(AnalyticsLayoutService);

    hide(): void {
        this.layout.setVisible(this.widgetId(), false);
    }
}
