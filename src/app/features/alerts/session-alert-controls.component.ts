import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { SessionAlertsService } from './session-alerts.service';

@Component({
    selector: 'app-session-alert-controls',
    standalone: true,
    templateUrl: './session-alert-controls.component.html',
    styleUrl: './session-alert-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionAlertControlsComponent {
    readonly sounds = inject(SessionAlertsService);
    constructor() { this.sounds.attach(inject(DestroyRef)); }
    volume(event: Event): void { this.sounds.setVolume(Number((event.target as HTMLInputElement).value)); }
    checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}
