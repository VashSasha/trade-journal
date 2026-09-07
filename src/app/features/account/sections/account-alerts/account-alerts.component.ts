import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SessionAlertControlsComponent } from '../../../alerts/session-alert-controls.component';
import { PerformanceAlertControlsComponent } from '../../../alerts/performance-alert-controls.component';
import { MarketEventAlertControlsComponent } from '../../../alerts/market-event-alert-controls.component';
import { CustomAlertSoundControlsComponent } from '../../../alerts/custom-alert-sound-controls.component';

/** Full alert configuration; the header keeps only the quick session control. */
@Component({
    selector: 'app-account-alerts',
    standalone: true,
    imports: [
        SessionAlertControlsComponent, CustomAlertSoundControlsComponent,
        PerformanceAlertControlsComponent, MarketEventAlertControlsComponent,
    ],
    templateUrl: './account-alerts.component.html',
    styleUrl: './account-alerts.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountAlertsComponent {}
