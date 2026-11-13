import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MarketEventAlertsService } from './market-event-alerts.service';
import { HelpTipComponent } from '../../shared/components/help-tip/help-tip.component';

@Component({
    selector: 'app-market-event-alert-controls',
    standalone: true,
    imports: [HelpTipComponent],
    templateUrl: './market-event-alert-controls.component.html',
    styleUrl: './market-event-alert-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketEventAlertControlsComponent {
    readonly alerts = inject(MarketEventAlertsService);
    checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
    number(event: Event): number { return Number((event.target as HTMLSelectElement).value); }
}
