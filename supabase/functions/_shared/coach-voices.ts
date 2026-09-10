/** Strict server allowlist, independent of client input and provider model names. */
export const COACH_AI_VOICES = [
    'cedar', 'marin', 'alloy', 'ash', 'ballad', 'coral', 'echo',
    'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
] as const;

export function isCoachAiVoice(value: unknown): value is typeof COACH_AI_VOICES[number] {
    return typeof value === 'string' && (COACH_AI_VOICES as readonly string[]).includes(value);
}
