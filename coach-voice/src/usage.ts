// Usage comes only from the authenticated provider sideband, never browser events.
export type DailyUsage = { tokens: number; estimatedTokens: number };
export type UsageEntry = { day: string; tokens: number | null };
export const UNREPORTED_TOKENS = 32_768;
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function tokenLimit(value: unknown): number {
    const limit = Number(value);
    return Number.isSafeInteger(limit) && limit >= 1000 && limit <= 1_000_000 ? limit : 50_000;
}
export function allowance(usage: DailyUsage | undefined, limit: number, day = utcDay()) {
    const usedTokens = (usage?.tokens ?? 0) + (usage?.estimatedTokens ?? 0);
    return { usedTokens, estimatedTokens: usage?.estimatedTokens ?? 0, limitTokens: limit,
        remainingTokens: Math.max(0, limit - usedTokens), resetsAt: new Date(Date.parse(day + 'T00:00:00Z') + 86_400_000).toISOString() };
}
export const limitMessage = (resetsAt: string) => `Daily voice allowance reached. Resets at ${resetsAt.slice(11, 16)} UTC on ${resetsAt.slice(0, 10)}. Text chat is still available.`;

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function providerUsage(event: Record<string, unknown>): { key: string; complete: boolean; tokens: number | null } | null {
    const response = record(event.response);
    const isResponse = event.type === 'response.created' || event.type === 'response.done';
    const isTranscript = event.type === 'input_audio_buffer.committed' || event.type === 'conversation.item.input_audio_transcription.completed';
    if (!isResponse && !isTranscript) return null;
    const id = isResponse ? response.id : event.item_id;
    if (typeof id !== 'string' || !/^[\w-]{1,150}$/.test(id)) throw new Error('Invalid provider usage identifier');
    const complete = event.type === 'response.done' || event.type === 'conversation.item.input_audio_transcription.completed';
    const usage = record(isResponse ? response.usage : event.usage);
    const total = usage.total_tokens;
    const tokens = complete && (isResponse || usage.type === 'tokens') && typeof total === 'number'
        && Number.isSafeInteger(total) && total >= 0 ? total : null;
    return { key: `${isResponse ? 'response' : 'transcript'}:${id}`, complete, tokens };
}
