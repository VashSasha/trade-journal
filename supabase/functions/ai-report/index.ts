// Paid AI proxy: validated bounded input, atomic quota, deadlines and explicit SSE errors.
import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@7.9.0';
import { buildParams } from '../_shared/ai-prompts.ts';
import { validateAiBody, MAX_AI_BODY_BYTES } from '../_shared/ai-validation.ts';
import { readJson, RequestError } from '../_shared/request-body.ts';
import { aiTextStream } from '../_shared/ai-stream.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) }) },
});
const allowed = new Set(['http://localhost:4200', Deno.env.get('APP_ORIGIN') ?? ''].filter(Boolean));

Deno.serve(async req => {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = origin && allowed.has(origin) ? {
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
    let settlement: Promise<void> | undefined;
    const cleanup = () => {
        clearTimeout(deadline); clearTimeout(firstByteDeadline);
        req.signal.removeEventListener('abort', abort);
    };
    // Retry-safe at the database boundary. A lost acknowledgement never refunds twice.
    const finish = (success: boolean): Promise<void> => settlement ??= (async () => {
        try {
            if (requestId && userId) {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const result = await admin.rpc('finish_ai_request', {
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
        const plan = await admin.rpc('effective_user_plan', { p_user_id: userId }).abortSignal(controller.signal);
        if (plan.error) throw new RequestError('Unable to verify your plan. Please try again.', 503);
        if (plan.data !== 'premium' && plan.data !== 'lifetime') {
            throw new RequestError('AI reports require a paid plan. Discord members: sign in with Discord again to refresh membership.', 403);
        }

        const body = validateAiBody(await readJson(req, MAX_AI_BODY_BYTES));
        const params = buildParams(body.type, body.payload)!;
        const key = Deno.env.get('OPENAI_API_KEY');
        if (!key) throw new RequestError('AI service is temporarily unavailable.', 503);
        const openai = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 40_000 });
        const candidate = crypto.randomUUID();
        const reservation = await admin.rpc('reserve_ai_request', {
            p_user_id: userId, p_request_id: candidate,
        }).abortSignal(controller.signal);
        if (reservation.error) throw new RequestError('Unable to check AI usage. Please try again.', 503);
        if (reservation.data !== 'reserved') {
            const message = reservation.data === 'busy' ? 'An analysis is already running. Please wait for it to finish.'
                : reservation.data === 'attempt_limit' ? 'Too many analysis attempts today. Please try again after midnight UTC.'
                : 'Daily AI limit reached (10 analyses). Your quota resets at midnight UTC.';
            throw new RequestError(message, 429);
        }
        requestId = candidate;
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
        const text = completion.choices[0]?.message?.content;
        if (!text?.trim()) throw new Error('Empty AI response');
        await finish(true);
        return json({ text });
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
