export const AI_COACHING_CONSENT_VERSION = 1;
export type AiCoachingMode = 'standard' | 'unhinged';
export function hasCoachingConsent(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row['unhinged'] === true && row['consent_version'] === AI_COACHING_CONSENT_VERSION
        && typeof row['consented_at'] === 'string' && Number.isFinite(Date.parse(row['consented_at']));
}
