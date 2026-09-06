import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AlertCenterService } from './alert-center.service';
import { MarketEventAlertsService } from './market-event-alerts.service';
import { PerformanceAlertsService } from './performance-alerts.service';

@Component({
    selector: 'app-performance-alert-toast',
    standalone: true,
    templateUrl: './performance-alert-toast.component.html',
    styleUrl: './performance-alert-toast.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceAlertToastComponent {
    readonly alerts = inject(AlertCenterService);
    // Instantiation keeps both monitors active on every authenticated page.
    readonly performance = inject(PerformanceAlertsService);
    readonly marketEvents = inject(MarketEventAlertsService);
}
