import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { getSessionsSnapshot } from './sessions.utils';
import { SessionScheduleService } from './session-schedule.service';

/** Scoped to the widget: no background work after its host is destroyed. */
@Injectable()
export class SessionsClockService {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly schedule = inject(SessionScheduleService);
    readonly now = signal(Date.now());
    readonly state = computed(() => {
        try { return { snapshot: getSessionsSnapshot(this.now(), this.schedule.definitions()), error: null }; }
        catch { return { snapshot: null, error: 'Session times are unavailable on this device.' }; }
    });

    constructor() {
        const view = this.document.defaultView;
        if (!view) return;
        const refresh = () => { if (!this.document.hidden) this.now.set(Date.now()); };
        // Calculate from the current clock, never from accumulated timer ticks.
        const timer = view.setInterval(refresh, 15_000);
        this.document.addEventListener('visibilitychange', refresh);
        view.addEventListener('focus', refresh);
        this.destroyRef.onDestroy(() => {
            view.clearInterval(timer);
            this.document.removeEventListener('visibilitychange', refresh);
            view.removeEventListener('focus', refresh);
        });
    }
}
