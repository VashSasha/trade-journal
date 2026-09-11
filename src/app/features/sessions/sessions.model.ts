/** Reference trading windows, NOT exchange calendars or instrument availability. */
export interface SessionDefinition {
    readonly id: string;
    readonly name: string;
    readonly city: string;
    readonly timeZone: string;
    /** Minutes after midnight in the session's own timezone. */
    readonly openMinute: number;
    readonly closeMinute: number;
    /** Days on which the window starts, Sunday = 0. Overnight ends may be on another day. */
    readonly weekdays: readonly number[];
}

export interface SessionWindow {
    readonly definition: SessionDefinition;
    readonly localDate: string;
    readonly opensAt: number;
    readonly closesAt: number;
}

export interface SessionState {
    readonly definition: SessionDefinition;
    readonly current: SessionWindow | null;
    readonly next: SessionWindow | null;
    readonly progress: number;
}

export interface SessionsSnapshot {
    readonly now: number;
    readonly sessions: readonly SessionState[];
    /** Earliest closing first, so the header describes the next boundary. */
    readonly active: readonly SessionState[];
    readonly next: SessionWindow | null;
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

// NVZN reference presets. Zone-local hours intentionally shift in UTC with DST.
// Holidays, exchange maintenance and special closes are not inferred here.
export const REFERENCE_SESSIONS: readonly SessionDefinition[] = [
    // Futures-oriented overnight reference, not the Tokyo exchange session.
    { id: 'asia', name: 'Asia / Overnight', city: 'Chicago', timeZone: 'America/Chicago', openMinute: 17 * 60, closeMinute: 2 * 60, weekdays: [0, 1, 2, 3, 4] },
    { id: 'london', name: 'London', city: 'London', timeZone: 'Europe/London', openMinute: 8 * 60, closeMinute: 17 * 60, weekdays: WEEKDAYS },
    // U.S. core cash session: 09:30–16:00 ET (08:30–15:00 CT).
    { id: 'new-york', name: 'New York', city: 'New York', timeZone: 'America/New_York', openMinute: 9 * 60 + 30, closeMinute: 16 * 60, weekdays: WEEKDAYS },
];
