// Paid AI proxy: validated bounded input, atomic quota, deadlines and explicit SSE errors.
import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@7.9.0';
import { buildParams, normalizeCoachModelText, normalizeCoachFollowUp } from '../_shared/ai-prompts.ts';
import { validateAiBody, MAX_AI_BODY_BYTES } from '../_shared/ai-validation.ts';
import { readJson, RequestError } from '../_shared/request-body.ts';
import { aiTextStream } from '../_shared/ai-stream.ts';
import { coachSpeech, COACH_VOICE_PREVIEW } from '../_shared/coach-speech.ts';
import { attachChatObservation } from '../_shared/coach-chat-observation.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) }) },
});
const allowed = new Set(['http://localhost:4200', 'http://127.0.0.1:4200', Deno.env.get('APP_ORIGIN') ?? ''].filter(Boolean));
const pagesOrigin = /^https:\/\/(?:[a-z0-9-]+\.)?trade-journal-2go\.pages\.dev$/i;

Deno.serve(async req => {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = origin && (allowed.has(origin) || pagesOrigin.test(origin)) ? {
        'Access-Control-Allow-Origin': origin, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    } : {};
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const controller = new AbortController();
    const abort = () => controller.abort();
    req.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, 75_000);
    let firstByteDeadline: ReturnType<typeof setTimeout> | undefined;
    let userId: string | undefined, requestId: string | undefined;
    let requestKind: 'report' | 'live-coach' = 'report';
    let settlement: Promise<void> | undefined;
    const cleanup = () => {
        clearTimeout(deadline); clearTimeout(firstByteDeadline);
        req.signal.removeEventListener('abort', abort);
    };
    // Retry-safe at the database boundary. A lost acknowledgement never refunds twice.
    const finish = (success: boolean): Promise<void> => settlement ??= (async () => {
        try {
            if (requestId && userId) {
                const rpc = requestKind === 'live-coach'
                    ? 'finish_live_coach_ai_request'
                    : 'finish_ai_request';
                for (let attempt = 0; attempt < 2; attempt++) {
                    const result = await admin.rpc(rpc, {
                        p_user_id: userId, p_request_id: requestId, p_success: success,
                    }).abortSignal(AbortSignal.timeout(5000));
                    if (!result.error) return;
                }
                console.error('AI quota settlement failed', { requestId });
            }
        } catch { console.error('AI quota settlement unavailable', { requestId }); }
        finally { cleanup(); }
    })();
    try {
        if (req.signal.aborted) throw new RequestError('Request cancelled.', 408);
        const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        if (!jwt) throw new RequestError('Missing Authorization header', 401);
        const { data, error } = await admin.auth.getUser(jwt);
        if (error || !data.user) throw new RequestError('Invalid or expired token', 401);
        userId = data.user.id;
        const access = await admin.rpc('effective_user_ai_access', { p_user_id: userId }).abortSignal(controller.signal);
        if (access.error) throw new RequestError('Unable to verify AI access. Please try again.', 503);
        if (access.data !== true) {
            throw new RequestError('AI features require Premium+ or an individual AI access grant.', 403);
        }

        const body = validateAiBody(await readJson(req, MAX_AI_BODY_BYTES));
        requestKind = body.type.startsWith('live-coach') ? 'live-coach' : 'report';
        const cachedChatTurn = async () => {
            const result = await admin.from('coach_chat_turns').select('conversation_id,prompt,answer,context')
                .eq('user_id', userId!).eq('id', body.payload.turnId).abortSignal(controller.signal).maybeSingle();
            if (result.error) throw new RequestError('Unable to load this conversation. Please try again.', 503);
            if (result.data && (result.data.conversation_id !== body.payload.conversationId || result.data.prompt !== body.payload.message
                || result.data.context?.replyTo?.id !== body.payload.context.replyTo?.id)) {
                throw new RequestError('This message ID belongs to a different question. Start a new message.', 409);
            }
            return result.data;
        };
        if (body.type === 'live-coach-chat') {
            const cached = await cachedChatTurn();
            if (cached) { cleanup(); return json({ followUp: cached.answer }); }
            const conversation = await admin.from('coach_conversations').select('id')
                .eq('user_id', userId).eq('id', body.payload.conversationId).abortSignal(controller.signal).maybeSingle();
            if (conversation.error) throw new RequestError('Unable to load this conversation. Please try again.', 503);
            if (!conversation.data) throw new RequestError('Conversation not found. Start a new conversation.', 404);
            await attachChatObservation(admin, userId, body.payload.context, controller.signal);
            const history = await admin.from('coach_chat_turns').select('prompt,answer,context', { count: 'exact' })
                .eq('user_id', userId).eq('conversation_id', body.payload.conversationId)
                .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6).abortSignal(controller.signal);
            if (history.error) throw new RequestError('Unable to load conversation history. Please try again.', 503);
            if ((history.count ?? 0) >= 100) throw new RequestError('This conversation is full. Start a new conversation.', 409);
            body.payload.history = (history.data ?? []).reverse();
        }
        const params = buildParams(body.type, body.payload)!;
        const key = Deno.env.get('OPENAI_API_KEY');
        if (!key) throw new RequestError('AI service is temporarily unavailable.', 503);
        const openai = new OpenAI({
            apiKey: key,
            maxRetries: 0,
            timeout: requestKind === 'live-coach' ? 8_000 : 40_000,
        });
        const candidate = crypto.randomUUID();
        const reserveRpc = requestKind === 'live-coach'
            ? 'reserve_live_coach_ai_request'
            : 'reserve_ai_request';
        const reservation = await admin.rpc(reserveRpc, {
            p_user_id: userId, p_request_id: candidate,
        }).abortSignal(controller.signal);
        if (reservation.error) throw new RequestError('Unable to check AI usage. Please try again.', 503);
        if (reservation.data !== 'reserved') {
            const message = requestKind === 'live-coach'
                ? reservation.data === 'busy' ? 'Another Coach comment is being prepared.'
                    : reservation.data === 'attempt_limit' ? 'Live Coach AI attempt limit reached for today.'
                    : 'Live Coach AI daily limit reached (30 comments).'
                : reservation.data === 'busy' ? 'An analysis is already running. Please wait for it to finish.'
                    : reservation.data === 'attempt_limit' ? 'Too many analysis attempts today. Please try again after midnight UTC.'
                    : 'Daily AI limit reached (10 analyses). Your quota resets at midnight UTC.';
            throw new RequestError(message, 429);
        }
        requestId = candidate;
        if (body.type === 'live-coach-chat') {
            // A concurrent retry may have finished since the first cache lookup.
            const cached = await cachedChatTurn();
            if (cached) { await finish(false); return json({ followUp: cached.answer }); }
        }
        if (body.type === 'live-coach-preview' || body.type === 'live-coach-speech') {
            const text = body.type === 'live-coach-preview' ? COACH_VOICE_PREVIEW : body.payload.text;
            const audio = await coachSpeech(openai, text, body.payload.voice, controller.signal);
            await finish(true);
            return json({ text, audio });
        }
        if (body.type === 'stream-analysis') {
            // Validate the first actual text before committing 200 response headers.
            firstByteDeadline = setTimeout(abort, 35_000);
            const stream = await openai.chat.completions.create({ ...params, stream: true }, { signal: controller.signal });
            async function* chunks() {
                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) yield content;
                }
            }
            const iterator = chunks();
            const first = await iterator.next();
            if (first.done) throw new Error('Empty AI response');
            clearTimeout(firstByteDeadline);
            return new Response(aiTextStream(first.value, iterator, abort, finish), {
                headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
            });
        }
        const completion = await openai.chat.completions.create({ ...params, stream: false }, { signal: controller.signal });
        const rawText = completion.choices[0]?.message?.content;
        if (body.type === 'live-coach-follow-up' || body.type === 'live-coach-chat') {
            const followUp = normalizeCoachFollowUp(rawText);
            if (!followUp) throw new Error('Invalid Coach follow-up');
            if (body.type === 'live-coach-chat') {
                if (followUp.meaning.length > 220) throw new Error('Coach answer is too long');
                const saved = await admin.from('coach_chat_turns').insert({ user_id: userId, id: body.payload.turnId,
                    conversation_id: body.payload.conversationId, prompt: body.payload.message, answer: followUp, context: body.payload.context,
                }).abortSignal(controller.signal);
                if (saved.error) throw new RequestError('The answer could not be saved. Refresh the conversation before retrying.', 503);
            }
            await finish(true);
            return json({ followUp }); // Written review only: never synthesize follow-up audio.
        }
        const text = requestKind === 'live-coach' ? normalizeCoachModelText(rawText) : rawText;
        if (!text?.trim()) throw new Error('Empty AI response');
        // Text remains useful if speech times out; never lose a valid comment.
        let voiceError: string | undefined;
        const audio = requestKind === 'live-coach'
            ? await coachSpeech(openai, text, body.payload.voice, controller.signal).catch(error => {
                const status = (error as { status?: number })?.status;
                console.warn('Coach speech failed', { status, requestId });
                voiceError = status === 429 ? 'The AI speech provider is rate-limited.' : 'AI speech failed or exceeded its time limit.';
                return undefined;
            }) : undefined;
        await finish(true);
        return json({ text, ...(audio ? { audio } : {}), ...(voiceError ? { voiceError } : {}) });
    } catch (error) {
        abort();
        await finish(false);
        if (error instanceof RequestError) return json({ error: error.message }, error.status);
        const status = (error as { status?: number })?.status;
        // Do not log prompts, tokens, upstream bodies, or private trading data.
        console.warn('AI upstream request failed', { status, requestId });
        if (status === 429) return json({ error: 'The AI service is busy. Please try again shortly.' }, 429);
        return json({ error: 'Analysis failed or timed out before producing a result. Please try again.' }, 502);
    }
});
