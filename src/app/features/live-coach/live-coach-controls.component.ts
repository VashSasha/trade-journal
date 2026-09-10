import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiveCoachService } from './live-coach.service';

@Component({
    selector: 'app-live-coach-controls',
    standalone: true,
    templateUrl: './live-coach-controls.component.html',
    styleUrl: './live-coach-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCoachControlsComponent {
    readonly coach = inject(LiveCoachService);

    checked(event: Event): boolean {
        return (event.target as HTMLInputElement).checked;
    }

    numberValue(event: Event): number {
        return Number((event.target as HTMLSelectElement).value);
    }
}
