import { REFERENCE_SESSIONS, SessionDefinition, SessionState, SessionWindow, SessionsSnapshot } from './sessions.model';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
    let value = formatters.get(timeZone);
    if (!value) {
        value = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        });
        formatters.set(timeZone, value);
    }
    return value;
}

/** Zone-local calendar parts encoded as a UTC number for arithmetic only. */
function wallStamp(instant: number, timeZone: string): number {
    const parts = formatter(timeZone).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
}

function dateKey(stamp: number): string { return new Date(stamp).toISOString().slice(0, 10); }
function dateStamp(date: string): number {
    const stamp = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) || dateKey(stamp) !== date) {
        throw new RangeError('Invalid session calendar date.');
    }
    return stamp;
}

/**
 * Convert a wall-clock boundary to an instant without the device's timezone.
 * Sample both sides of DST to resolve offsets. In a repeated hour, openings
 * use the first occurrence and closings the last. A nonexistent boundary is
 * rejected rather than silently shifted. Current presets avoid DST-change hours.
 */
function boundary(stamp: number, minute: number, zone: string, closing = false): number {
    const target = stamp + minute * MINUTE;
    const offsets = new Set([-DAY, 0, DAY].map(delta => wallStamp(target + delta, zone) - (target + delta)));
    const matches = [...offsets].map(offset => target - offset).filter(instant => wallStamp(instant, zone) === target);
    if (!matches.length) throw new RangeError('A session boundary does not exist in this timezone.');
    return closing ? Math.max(...matches) : Math.min(...matches);
}

function validate(definition: SessionDefinition): void {
    if (!definition.id || ![definition.openMinute, definition.closeMinute].every(n => Number.isInteger(n) && n >= 0 && n < 1440) ||
        definition.openMinute === definition.closeMinute ||
        definition.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new RangeError('Invalid session definition.');
    }
    formatter(definition.timeZone); // Validate IANA timezone even on a weekend.
}

/** Reusable by future analytics and alerts; never changes stored trade dates. */
export function sessionWindowOn(definition: SessionDefinition, localDate: string): SessionWindow | null {
    validate(definition);
    const stamp = dateStamp(localDate);
    if (!definition.weekdays.includes(new Date(stamp).getUTCDay())) return null;
    const endDay = stamp + (definition.closeMinute < definition.openMinute ? DAY : 0);
    return {
        definition, localDate,
        opensAt: boundary(stamp, definition.openMinute, definition.timeZone),
        closesAt: boundary(endDay, definition.closeMinute, definition.timeZone, true),
    };
}

/** Start-inclusive / end-exclusive; multiple sessions can be active together. */
export function getSessionsSnapshot(now: number, definitions = REFERENCE_SESSIONS): SessionsSnapshot {
    if (!Number.isFinite(now)) throw new RangeError('Invalid session clock.');
    if (new Set(definitions.map(d => d.id)).size !== definitions.length) throw new RangeError('Session IDs must be unique.');
    const sessions: SessionState[] = definitions.map(definition => {
        const today = dateStamp(dateKey(wallStamp(now, definition.timeZone)));
        const windows: SessionWindow[] = [];
        // Yesterday includes overnight windows; seven days ahead finds the next
        // opening even when a preset is scheduled only once a week.
        for (let day = -1; day <= 7; day++) {
            const window = sessionWindowOn(definition, dateKey(today + day * DAY));
            if (window) windows.push(window);
        }
        const current = windows.find(w => w.opensAt <= now && now < w.closesAt) ?? null;
        const next = windows.find(w => w.opensAt > now) ?? null;
        const progress = current ? 100 * (now - current.opensAt) / (current.closesAt - current.opensAt) : 0;
        return { definition, current, next, progress: Math.max(0, Math.min(100, progress)) };
    });
    return {
        now, sessions,
        active: sessions.filter(s => s.current).sort((a, b) => a.current!.closesAt - b.current!.closesAt),
        next: sessions.flatMap(s => s.next ? [s.next] : []).sort((a, b) => a.opensAt - b.opensAt)[0] ?? null,
    };
}

export function sessionCountdown(milliseconds: number): string {
    const minutes = Math.max(1, Math.ceil(milliseconds / MINUTE));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    if (days) return `${days}d${hours ? ` ${hours}h` : ''}`;
    if (hours) return `${hours}h${rest ? ` ${rest}m` : ''}`;
    return `${rest}m`;
}

export function sessionWallTime(minute: number): string {
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
