import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DashboardWidgetId } from '../dashboard-layout.model';
import { DashboardLayoutService } from '../dashboard-layout.service';

@Component({
    selector: 'app-dashboard-widget-frame',
    standalone: true,
    templateUrl: './dashboard-widget-frame.component.html',
    styleUrl: './dashboard-widget-frame.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardWidgetFrameComponent {
    readonly widgetId = input.required<DashboardWidgetId>();
    readonly label = input.required<string>();
    readonly layout = inject(DashboardLayoutService);

    hide(): void {
        this.layout.setVisible(this.widgetId(), false);
    }
}
