import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PerformanceAlertsService } from './performance-alerts.service';
import { PerformanceAlertRule } from './performance-alerts.utils';

@Component({
    selector: 'app-performance-alert-controls',
    standalone: true,
    templateUrl: './performance-alert-controls.component.html',
    styleUrl: './performance-alert-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceAlertControlsComponent {
    readonly alerts = inject(PerformanceAlertsService);

    checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
    value(event: Event): number { return Number((event.target as HTMLInputElement).value); }
    setEnabled(rule: PerformanceAlertRule, event: Event): void { this.alerts.setEnabled(rule, this.checked(event)); }
    setValue(rule: PerformanceAlertRule, event: Event): void { this.alerts.setValue(rule, this.value(event)); }
}
