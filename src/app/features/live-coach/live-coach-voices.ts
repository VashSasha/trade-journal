/** Built-in gpt-4o-mini-tts voices; kept in sync with the server by contract tests. */
export const LIVE_COACH_AI_VOICES = [
    'cedar', 'marin', 'alloy', 'ash', 'ballad', 'coral', 'echo',
    'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
] as const;

export type LiveCoachVoice = 'browser' | typeof LIVE_COACH_AI_VOICES[number];
export const DEFAULT_LIVE_COACH_VOICE: LiveCoachVoice = 'cedar';
export const LIVE_COACH_AI_VOICE_OPTIONS = LIVE_COACH_AI_VOICES.map(id => ({
    id,
    label: `${id.charAt(0).toUpperCase()}${id.slice(1)}${id === DEFAULT_LIVE_COACH_VOICE ? ' · Default' : ''}`,
}));

export function isLiveCoachVoice(value: unknown): value is LiveCoachVoice {
    return value === 'browser'
        || (typeof value === 'string' && (LIVE_COACH_AI_VOICES as readonly string[]).includes(value));
}
