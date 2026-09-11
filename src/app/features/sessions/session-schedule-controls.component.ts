import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SessionScheduleService } from './session-schedule.service';
import { sessionWallTime } from './sessions.utils';
import { SessionAlertControlsComponent } from '../alerts/session-alert-controls.component';

@Component({
    selector: 'app-session-schedule-controls',
    standalone: true,
    imports: [SessionAlertControlsComponent],
    templateUrl: './session-schedule-controls.component.html',
    styleUrl: './session-schedule-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionScheduleControlsComponent {
    readonly schedule = inject(SessionScheduleService);
    readonly errors = signal<Record<string, string>>({});
    readonly editing = signal<string | null>(null);
    readonly opening = signal('');
    readonly closing = signal('');
    readonly time = sessionWallTime;
    edit(id: string): void {
        const pref = this.schedule.preferences()[id];
        this.opening.set(this.time(pref.openMinute));
        this.closing.set(this.time(pref.closeMinute));
        this.errors.set({});
        this.editing.set(id);
    }
    setEnabled(id: string, event: Event): void {
        this.schedule.setEnabled(id, (event.target as HTMLInputElement).checked);
    }
    reset(id: string): void {
        this.schedule.reset(id);
        this.edit(id);
    }
    save(id: string, event: Event): void {
        event.preventDefault();
        const parse = (value: string) => {
            const match = value.trim().match(/^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*(AM|PM)$/i);
            if (!match) return NaN;
            return (Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(match[2] ?? 0);
        };
        const ok = this.schedule.setHours(id, parse(this.opening()), parse(this.closing()));
        this.errors.update(value => ({ ...value, [id]: ok ? '' : 'Use a time like 5:00 PM. Opening and closing must be different.' }));
        if (ok) this.editing.set(null);
    }
}
