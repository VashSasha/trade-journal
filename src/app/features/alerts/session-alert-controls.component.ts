import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { SessionAlertsService } from './session-alerts.service';

@Component({
    selector: 'app-session-alert-controls',
    standalone: true,
    templateUrl: './session-alert-controls.component.html',
    styleUrl: './session-alert-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-sound-controls': '' },
})
export class SessionAlertControlsComponent {
    readonly sounds = inject(SessionAlertsService);
    readonly expanded = input(false);
    readonly settingsView = input(false);
    readonly section = input<'all' | 'master' | 'bells'>('all');
    volume(event: Event): void { this.sounds.setVolume(Number((event.target as HTMLInputElement).value)); }
    checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}
