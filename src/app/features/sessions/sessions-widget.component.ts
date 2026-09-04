import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { SessionsClockService } from './sessions-clock.service';
import { SessionState, SessionWindow } from './sessions.model';
import { sessionCountdown, sessionWallTime } from './sessions.utils';
import { SessionAlertControlsComponent } from '../alerts/session-alert-controls.component';
import { SessionAlertsService } from '../alerts/session-alerts.service';

@Component({
    selector: 'app-sessions-widget',
    standalone: true,
    imports: [SessionAlertControlsComponent],
    providers: [SessionsClockService],
    templateUrl: './sessions-widget.component.html',
    styleUrl: './sessions-widget.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(window:resize)': 'positionPanel()' },
})
export class SessionsWidgetComponent {
    readonly clock = inject(SessionsClockService);
    readonly sounds = inject(SessionAlertsService);
    private readonly document = inject(DOCUMENT);
    private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
    private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
    readonly panelId = `sessions-${crypto.randomUUID()}`;
    readonly opened = signal(false);
    readonly left = signal(12);
    readonly top = signal(72);
    readonly maxHeight = signal(600);
    readonly displayZone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    readonly zones = [...new Set([this.displayZone(), 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])];
    private readonly displayFormatter = computed(() => new Intl.DateTimeFormat('en-US', {
        timeZone: this.displayZone(), weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
    readonly snapshot = computed(() => this.clock.state().snapshot);
    readonly title = computed(() => {
        const state = this.snapshot();
        return !state ? 'Unavailable' : state.active.length
            ? state.active.map(s => s.definition.name).join(' + ') : 'Between sessions';
    });
    readonly detail = computed(() => {
        const state = this.snapshot();
        if (!state) return 'Check your device clock';
        if (state.active.length) {
            const first = state.active[0];
            return `${state.active.length > 1 ? first.definition.name + ' ends' : 'Ends'} in ${sessionCountdown(first.current!.closesAt - state.now)}`;
        }
        return state.next ? `${state.next.definition.name} in ${sessionCountdown(state.next.opensAt - state.now)}` : 'No upcoming windows';
    });
    readonly triggerLabel = computed(() => `Sessions: ${this.title()}. ${this.detail()}. Sounds ${this.sounds.enabled() ? 'on' : this.sounds.waitingForGesture() ? 'ready to reactivate' : 'off'}. Show reference schedule.`);
    readonly wallTime = sessionWallTime;

    timing(state: SessionState): string {
        const now = this.clock.now();
        return state.current ? `Ends in ${sessionCountdown(state.current.closesAt - now)}`
            : state.next ? `Starts in ${sessionCountdown(state.next.opensAt - now)}` : 'Not scheduled';
    }

    formatWindow(window: SessionWindow): string {
        // Compact on one date; retains both dates when the viewer's zone makes
        // a session cross midnight. Reuse the formatter across clock ticks.
        return this.displayFormatter().formatRange(window.opensAt, window.closesAt);
    }

    changeZone(event: Event): void {
        const zone = (event.target as HTMLSelectElement).value;
        if (this.zones.includes(zone)) this.displayZone.set(zone);
    }

    onToggle(event: Event): void {
        this.opened.set((event as ToggleEvent).newState === 'open');
        if (this.opened()) this.positionPanel();
    }

    positionPanel(): void {
        const view = this.document.defaultView;
        if (!view) return;
        const rect = this.trigger().nativeElement.getBoundingClientRect();
        const panel = this.panel().nativeElement;
        const width = panel.getBoundingClientRect().width || Math.min(400, view.innerWidth - 24);
        const below = view.innerHeight - rect.bottom - 20;
        const height = Math.min(panel.scrollHeight || 560, view.innerHeight - 24);
        const top = below < 200 && rect.top > below ? Math.max(12, rect.top - height - 8) : Math.min(rect.bottom + 8, view.innerHeight - 100);
        this.left.set(Math.max(12, Math.min(rect.right - width, view.innerWidth - width - 12)));
        this.top.set(top);
        this.maxHeight.set(Math.max(80, view.innerHeight - top - 12));
    }
}
