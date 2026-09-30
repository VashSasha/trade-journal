import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { validateAiBody } from './ai-validation.ts';
import { RequestError } from './request-body.ts';

/** Resolve only the authenticated owner's immutable saved original, before spending quota. */
export async function attachChatObservation(client: SupabaseClient, userId: string, context: Record<string, any>, signal: AbortSignal) {
    if (!context.replyTo) return;
    const { data, error } = await client.from('live_coach_history').select('id,observed_at,title,content,snapshot')
        .eq('user_id', userId).eq('id', context.replyTo.id).abortSignal(signal).maybeSingle();
    if (error) throw new RequestError('Unable to load the original update. Please retry.', 503);
    if (!data) throw new RequestError('Original update is not saved or has been deleted. Retry saving it, or send a new message.', 404);
    const original = validateAiBody({ type: 'live-coach-follow-up', payload: {
        question: 'explain', comment: data.content.slice(0, 1000), observedAt: data.observed_at, snapshot: data.snapshot,
    } }).payload;
    context.replyTo = { id: data.id, title: data.title, text: original.comment, observedAt: original.observedAt, snapshot: original.snapshot };
}
