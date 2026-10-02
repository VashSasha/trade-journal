import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { FilterService } from '../../core/services/filter.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { TradovateLivePositionEventKind } from '../integrations/tradovate-live/tradovate-live.models';
import { AlertAudioService } from './alert-audio.service';
import { SessionAlertsService } from './session-alerts.service';
import { AlertSoundKind, POSITION_SOUND_KINDS } from './alert-sound-kinds';
import { soundSelection } from './alert-sound-library';

export const POSITION_EVENT_SOUNDS: Record<TradovateLivePositionEventKind, AlertSoundKind> = {
    opened: 'positionOpened', increased: 'positionIncreased', reduced: 'positionReduced',
    closed: 'positionClosed', reversed: 'positionReversed',
};

/** Optional local cues, not AI calls. Consume the existing normalized leader-tab stream. */
@Injectable({ providedIn: 'root' })
export class PositionSoundAlertsService {
    private readonly live = inject(TradovateLiveService);
    private readonly sounds = inject(SessionAlertsService);
    private readonly audio = inject(AlertAudioService);
    private readonly session = inject(UserSessionService);
    private readonly access = inject(AccessPolicyService);
    private readonly filters = inject(FilterService);
    private readonly active = signal(false);
    private context = '';
    private readonly seen = new Set<string>();
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        effect(() => {
            const prefs = this.sounds.preferences();
            const enabled = this.active() && !!this.session.userId() && this.access.canAct('sync')
                && this.sounds.enabled() && POSITION_SOUND_KINDS.some(kind =>
                    soundSelection(kind, prefs.selections, !!this.audio.customSounds()[kind]) !== 'silent');
            this.live.setRequested('position-sounds', enabled);
        });
        effect(() => {
            const owner = this.session.userId();
            const filter = this.filters.filters();
            const selected = filter.accountSelectionActive ? [...filter.accountIds].sort() : null;
            const ready = this.active() && !!owner && this.access.canAct('sync') && this.sounds.enabled()
                && this.live.state() === 'live' && !this.sounds.previewing();
            const selections = this.sounds.preferences().selections;
            const uploads = this.audio.customSounds();
            const context = JSON.stringify([owner, ready, selected, selections]);
            const events = this.live.positionEvents();
            if (context !== this.context) {
                this.context = context;
                this.clearPending();
                // Switching accounts, reconnecting, changing cues or unmuting never replays old events.
                events.forEach(event => this.seen.add(event.eventId));
            }
            for (const event of events) {
                if (this.seen.has(event.eventId)) continue;
                this.seen.add(event.eventId);
                const kind = POSITION_EVENT_SOUNDS[event.kind];
                const age = Date.now() - event.observedAt;
                if (!ready || !kind || !Number.isFinite(age) || age < 0 || age > 5000
                    || (selected && !selected.includes(String(event.accountId)))
                    || soundSelection(kind, selections, !!uploads[kind]) === 'silent') continue;
                // One cue for copied updates of the same instrument/event, not one per account.
                const instrument = event.contractId ?? `${event.connectionId}:${event.positionId}`;
                const key = `${instrument}:${event.kind}:${event.direction}`;
                if (this.pending.has(key)) continue;
                this.pending.set(key, setTimeout(() => {
                    this.pending.delete(key);
                    if (context !== this.context || !this.active() || owner !== this.session.userId()
                        || !this.access.canAct('sync') || this.live.state() !== 'live' || !this.sounds.enabled()) return;
                    this.sounds.announce(kind, `Position ${event.kind}.`);
                }, 900));
            }
            while (this.seen.size > 250) this.seen.delete(this.seen.values().next().value!);
        });
        inject(DestroyRef).onDestroy(() => this.clearPending());
    }

    attach(host: DestroyRef): void {
        this.active.set(true);
        host.onDestroy(() => {
            this.active.set(false);
            this.clearPending();
            untracked(() => this.live.setRequested('position-sounds', false));
        });
    }

    private clearPending(): void {
        this.pending.forEach(timer => clearTimeout(timer));
        this.pending.clear();
    }
}
