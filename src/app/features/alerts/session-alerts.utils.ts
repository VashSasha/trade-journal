import { SessionsSnapshot } from '../sessions/sessions.model';

export type SessionAlertKind = 'open' | 'close';
/** Semantic cue mapped to either the built-in audio or a user-selected file. */
export type AlertSoundKind = SessionAlertKind | 'target' | 'risk';
export interface SessionAlert {
    id: string;
    kind: SessionAlertKind;
    at: number;
    text: string;
}
export interface SessionSoundPreferences {
    volume: number;
    opens: boolean;
    closes: boolean;
    /** User opted in; audio still needs one gesture after each page load. */
    armed: boolean;
}
export const DEFAULT_SESSION_SOUNDS: Readonly<SessionSoundPreferences> = { volume: 45, opens: true, closes: true, armed: false };
export const MAX_ALERT_GAP_MS = 90_000;

/** Persist non-sensitive preferences and opt-in intent, never runtime audio/permission state. */
export function parseSoundPreferences(raw: string | null): SessionSoundPreferences {
    try {
        const value: unknown = JSON.parse(raw ?? 'null');
        if (!value || typeof value !== 'object') return { ...DEFAULT_SESSION_SOUNDS };
        const p = value as Partial<SessionSoundPreferences>;
        const volume = typeof p.volume === 'number' && Number.isFinite(p.volume)
            ? Math.round(Math.max(0, Math.min(100, p.volume))) : DEFAULT_SESSION_SOUNDS.volume;
        const opens = typeof p.opens === 'boolean' ? p.opens : true;
        const closes = typeof p.closes === 'boolean' ? p.closes : true;
        return { volume, opens, closes, armed: p.armed === true && volume > 0 };
    } catch { return { ...DEFAULT_SESSION_SOUNDS }; }
}

/** Only recent boundaries crossed since our last observation. Never replay a backlog. */
export function crossedSessionAlerts(previous: SessionsSnapshot, now: number): SessionAlert[] {
    if (!Number.isFinite(now) || now <= previous.now || now - previous.now > MAX_ALERT_GAP_MS) return [];
    const events: SessionAlert[] = [];
    for (const session of previous.sessions) {
        for (const window of [session.current, session.next]) {
            if (!window) continue;
            for (const kind of ['open', 'close'] as const) {
                const at = kind === 'open' ? window.opensAt : window.closesAt;
                if (at > previous.now && at <= now) events.push({
                    id: `${session.definition.id}:${kind}:${at}`, kind, at,
                    text: `${session.definition.name} reference window ${kind === 'open' ? 'started' : 'ended'}.`,
                });
            }
        }
    }
    return events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
