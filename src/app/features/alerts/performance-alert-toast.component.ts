import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PerformanceAlertsService } from './performance-alerts.service';

@Component({
    selector: 'app-performance-alert-toast',
    standalone: true,
    templateUrl: './performance-alert-toast.component.html',
    styleUrl: './performance-alert-toast.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceAlertToastComponent {
    readonly alerts = inject(PerformanceAlertsService);
}
