import { computed, inject, Injectable } from '@angular/core';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { REFERENCE_SESSIONS } from './sessions.model';
import { parseSessionPreferences } from './session-preferences';

/** One account-synced schedule shared by the header and session bells. */
@Injectable({ providedIn: 'root' })
export class SessionScheduleService {
    private readonly store = inject(AccountAlertPreferencesService);
    readonly preferences = this.store.sessions;
    readonly loading = this.store.loading;
    readonly syncWarning = this.store.syncWarning;
    readonly storageWarning = this.store.storageWarning;
    readonly presets = REFERENCE_SESSIONS;
    readonly definitions = computed(() => this.presets
        .filter(definition => this.preferences()[definition.id].enabled)
        .map(definition => ({ ...definition, ...this.preferences()[definition.id] })));

    setEnabled(id: string, enabled: boolean): void {
        if (!this.presets.some(d => d.id === id)) return;
        this.store.updateSessions(current => ({ ...current, [id]: { ...current[id], enabled } }));
    }

    setHours(id: string, openMinute: number, closeMinute: number): boolean {
        if (!this.presets.some(d => d.id === id) || openMinute === closeMinute
            || ![openMinute, closeMinute].every(n => Number.isInteger(n) && n >= 0 && n < 1440)) return false;
        this.store.updateSessions(current => ({ ...current, [id]: { ...current[id], openMinute, closeMinute } }));
        return true;
    }

    reset(id: string): void {
        if (!this.presets.some(d => d.id === id)) return;
        const defaults = parseSessionPreferences(null)[id];
        this.store.updateSessions(current => ({ ...current,
            [id]: { ...defaults, enabled: current[id].enabled },
        }));
    }
}
