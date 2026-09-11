import { REFERENCE_SESSIONS } from './sessions.model';

export interface SessionPreference { enabled: boolean; openMinute: number; closeMinute: number; }
export type SessionPreferences = Record<string, SessionPreference>;

export function parseSessionPreferences(raw: string | null): SessionPreferences {
    let source: Record<string, unknown> = {};
    try {
        const value = JSON.parse(raw ?? 'null');
        if (value && typeof value === 'object' && !Array.isArray(value)) source = value;
    } catch { /* Use reference defaults if the cache is invalid. */ }
    const minute = (value: unknown): value is number => typeof value === 'number'
        && Number.isInteger(value) && value >= 0 && value < 1440;
    return Object.fromEntries(REFERENCE_SESSIONS.map(definition => {
        const rawValue = source[definition.id];
        const value = rawValue && typeof rawValue === 'object' ? rawValue as Partial<SessionPreference> : {};
        const validHours = minute(value.openMinute) && minute(value.closeMinute) && value.openMinute !== value.closeMinute;
        return [definition.id, {
            enabled: value.enabled !== false,
            openMinute: validHours ? value.openMinute! : definition.openMinute,
            closeMinute: validHours ? value.closeMinute! : definition.closeMinute,
        }];
    }));
}
