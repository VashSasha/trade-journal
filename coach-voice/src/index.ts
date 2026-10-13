import { DurableObject } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { readJson, RequestError } from '../../supabase/functions/_shared/request-body';
import { resolveCoachingMode } from '../../supabase/functions/_shared/coaching-mode';
import { attachChatObservation } from '../../supabase/functions/_shared/coach-chat-observation';
import { coachChatContext } from '../../supabase/functions/_shared/coach-chat';
import { allowedOrigin, CALL_MS, callIdFromLocation, HEARTBEAT_MS, IDLE_MS, transcript, uuid, validateStart, voiceInstructions } from './policy';
import { allowance, DailyUsage, limitMessage, providerUsage, tokenLimit, UNREPORTED_TOKENS, UsageEntry, utcDay } from './usage';
import { CONTEXT_TOKENS, displayEvent, OUTPUT_TOKENS, readAnswer, replyReservation, voiceSession, VOICE_PROTOCOL } from './controls';

type VoiceEnv = Omit<Env, 'VOICE_ENABLED'> & { VOICE_ENABLED: string; OPENAI_API_KEY: string; SB_SECRET_KEY: string };
type ActiveCall = { sessionId: string; userId: string; conversationId: string; context: Record<string, unknown>;
    callId?: string; deadline: number; lease: number; activity: number; closing?: boolean; instructions?: string; mode?: 'standard' | 'unhinged'; unplayed?: string[];
    usage?: Record<string, UsageEntry>; protocol?: string; voice?: string; queuedInput?: string;
    committedInputs?: string[]; reply?: { requestId: string; responseId?: string; day: string; reservedTokens: number } };
type Message = { user_id: string; conversation_id: string; session_id: string; item_id: string; role: string;
    content: string; interrupted: boolean; context: Record<string, unknown>; created_at: string };
function admin(env: VoiceEnv) {
    return createClient(env.SUPABASE_URL, env.SB_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
}
const provider = (env: VoiceEnv, path: string, init: RequestInit = {}) => fetch(`https://api.openai.com/v1/${path}`, {
    ...init, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15000),
});
async function connectSideband(env: VoiceEnv, callId: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        return await provider(env, `realtime?call_id=${encodeURIComponent(callId)}`, {
            headers: { Upgrade: 'websocket' }, signal: controller.signal,
        });
    } finally {
        // A fetch abort also closes its upgraded WebSocket. Bound only the handshake;
        // the Durable Object's deadline, heartbeat and idle alarms bound the call.
        clearTimeout(timeout);
    }
}
function failure(error: unknown): Response {
    return Response.json({ error: error instanceof RequestError ? error.message : 'Voice is temporarily unavailable. Please try again.' },
        { status: error instanceof RequestError ? error.status : 503 });
}

export default {
    async fetch(req: Request, env: VoiceEnv): Promise<Response> {
        const origin = req.headers.get('Origin') ?? '';
        if (!allowedOrigin(origin, env.APP_ORIGIN)) return new Response('Origin not allowed', { status: 403 });
        const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store',
            'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        let response: Response;
        try {
            const action = new URL(req.url).pathname.slice(1);
            if (req.method !== 'POST' || !['start', 'heartbeat', 'end', 'events'].includes(action)) throw new RequestError('Not found.', 404);
            if (action !== 'end' && env.VOICE_ENABLED !== 'true') throw new RequestError('Voice conversations are not enabled yet.', 503);
            const token = req.headers.get('Authorization')?.match(/^Bearer (.{1,8000})$/)?.[1];
            if (!token) throw new RequestError('Please sign in again.', 401);
            const client = admin(env);
            const { data, error } = await client.auth.getUser(token);
            if (error || !data.user) throw new RequestError('Please sign in again.', 401);
            const body = await readJson(req, 52000);
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request.');
            const stub = env.VOICE_SESSIONS.getByName(data.user.id);
            response = await stub.handle(data.user.id, action, body as Record<string, unknown>);
        } catch (error) { response = failure(error); }
        const result = new Response(response.body, response);
        Object.entries(headers).forEach(([key, value]) => result.headers.set(key, value));
        return result;
    },
} satisfies ExportedHandler<VoiceEnv>;

/** One coordinator per verified user. Durable alarms, not browser timers, end paid calls. */
export class CoachVoiceSession extends DurableObject<VoiceEnv> {
    private sideband: WebSocket | null = null;
    private events: Promise<void> = Promise.resolve();
    private ending: Promise<void> | null = null;
    private interrupted = new Set<string>();
    private receivedItems = new Set<string>();
    private itemTimes = new Map<string, string>();
    private flushing: Promise<void> | null = null;
    private feed: { sessionId: string; controller: ReadableStreamDefaultController<Uint8Array> } | null = null;

    async handle(userId: string, action: string, body: Record<string, unknown>): Promise<Response> {
        try {
            if (!uuid(body.sessionId)) throw new RequestError('Invalid session.');
            if (action === 'end') {
                await this.end(body.sessionId);
                return await this.ended(body.sessionId);
            }
            const client = admin(this.env);
            const access = await client.rpc('effective_user_ai_access', { p_user_id: userId });
            if (access.error || access.data !== true) {
                await this.end(body.sessionId);
                throw new RequestError(access.error ? 'Could not check AI access.' : 'Voice requires AI access.', access.error ? 503 : 403);
            }
            if (action === 'start') return await this.start(userId, body);
            const active = await this.ctx.storage.get<ActiveCall>('active');
            if (!active || active.sessionId !== body.sessionId || active.closing) return await this.ended(body.sessionId);
            if (active.protocol !== VOICE_PROTOCOL) {
                await this.end(active.sessionId, 'Voice security was updated. Refresh the app and try again.');
                return await this.ended(body.sessionId);
            }
            if (Date.now() >= active.deadline) { await this.end(active.sessionId); return Response.json({ ended: true }); }
            if (active.mode === 'unhinged' && await resolveCoachingMode(client, userId, 'unhinged', AbortSignal.timeout(8000)) !== 'unhinged') {
                await this.end(active.sessionId); return Response.json({ ended: true });
            }
            // A heartbeat confirms the owner is still entitled and this exact conversation still exists.
            const conversation = await client.from('coach_conversations').select('id').eq('user_id', userId).eq('id', active.conversationId).maybeSingle();
            if (conversation.error || !conversation.data) { await this.end(active.sessionId); throw new RequestError('Conversation is no longer available.', 409); }
            const current = await this.ctx.storage.get<ActiveCall>('active');
            if (!current || current.sessionId !== active.sessionId || current.closing) return await this.ended(body.sessionId);
            if (action === 'events') return this.openEvents(current.sessionId);
            current.lease = Date.now() + HEARTBEAT_MS;
            await this.ctx.storage.put('active', current);
            await this.schedule(current);
            return Response.json({ ended: false, deadline: current.deadline, usage: await this.usageSnapshot(), saving: (await this.ctx.storage.list({ prefix: 'outbox:' })).size > 0 });
        } catch (error) {
            const response = failure(error);
            if (error instanceof RequestError && error.status === 429)
                return Response.json({ error: error.message, usage: await this.usageSnapshot() }, { status: 429 });
            return response;
        }
    }

    private async usageSnapshot() {
        return allowance(await this.ctx.storage.get<DailyUsage>(`usage:${utcDay()}`), tokenLimit(this.env.VOICE_DAILY_TOKEN_LIMIT));
    }

    private async ended(sessionId: string): Promise<Response> {
        const usage = await this.usageSnapshot();
        const ended = await this.ctx.storage.get<{ sessionId: string; message: string }>('lastEnd');
        return Response.json({ ended: true, usage,
            message: usage.remainingTokens === 0 ? limitMessage(usage.resetsAt) : ended?.sessionId === sessionId ? ended.message : undefined });
    }

    private async start(userId: string, body: Record<string, unknown>): Promise<Response> {
        if (this.ending) throw new RequestError('The previous call is still ending. Please wait a moment.', 409);
        if (!this.env.OPENAI_API_KEY) throw new RequestError('Voice is not configured.', 503);
        const input = validateStart(body), client = admin(this.env);
        const context = input.context;
        const [conversation, turns, messages] = await Promise.all([
            client.from('coach_conversations').select('id').eq('user_id', userId).eq('id', input.conversationId).maybeSingle(),
            client.from('coach_chat_turns').select('prompt,answer,context,created_at').eq('user_id', userId).eq('conversation_id', input.conversationId).order('created_at', { ascending: false }).limit(6),
            client.from('coach_voice_messages').select('role,content,interrupted,context,created_at', { count: 'exact' }).eq('user_id', userId).eq('conversation_id', input.conversationId).order('created_at', { ascending: false }).limit(12),
        ]);
        if (conversation.error || turns.error || messages.error) throw new RequestError('Could not load chat. Check the voice migration has been applied.', 503);
        if (!conversation.data) throw new RequestError('Conversation not found.', 404);
        if ((messages.count ?? 0) > 160) throw new RequestError('This voice conversation is full. Start a new chat to continue.', 409);
        await attachChatObservation(client, userId, context, AbortSignal.timeout(8000));
        const mode = await resolveCoachingMode(client, userId, body.coachingMode, AbortSignal.timeout(8000));
        const history = [...(turns.data ?? []), ...(messages.data ?? [])].map(t => ({ ...t, context: coachChatContext(t.context) }))
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const instructions = voiceInstructions(context, history, mode);
        const now = Date.now();
        const active: ActiveCall = { sessionId: input.sessionId, userId, conversationId: input.conversationId,
            context, deadline: now + CALL_MS, lease: now + HEARTBEAT_MS, activity: now, instructions, mode,
            protocol: VOICE_PROTOCOL, voice: input.voice };
        // Atomic admission prevents simultaneous tabs/devices and repeated starts bypassing the quota.
        await this.ctx.storage.transaction(async storage => {
            if (await storage.get('active')) throw new RequestError('A voice call is already active. End it or wait for it to expire.', 409);
            const usage = allowance(await storage.get<DailyUsage>(`usage:${utcDay(now)}`), tokenLimit(this.env.VOICE_DAILY_TOKEN_LIMIT));
            if (!usage.remainingTokens) throw new RequestError(limitMessage(usage.resetsAt), 429);
            if (usage.remainingTokens < replyReservation(instructions)) throw new RequestError('Not enough voice allowance for another reply. Text chat is still available.', 429);
            const starts = (await storage.get<number[]>('starts') ?? []).filter(time => time > now - 60_000);
            if (starts.length >= 10) throw new RequestError('Too many voice starts. Wait a minute and try again. Text chat is still available.', 429);
            // No daily call cap or token charge just for starting. Keep a short abuse throttle.
            await storage.put({ starts: [...starts, now], active });
            await storage.setAlarm(active.lease);
        });
        this.interrupted.clear(); this.receivedItems.clear(); this.itemTimes.clear();
        try {
            const form = new FormData();
            form.set('sdp', input.sdp);
            form.set('session', JSON.stringify(voiceSession(this.env.VOICE_MODEL, instructions, input.voice)));
            const created = await provider(this.env, 'realtime/calls', { method: 'POST', body: form });
            if (!created.ok) throw new RequestError('Voice provider could not start the call. Please try later.', 502);
            const callId = callIdFromLocation(created.headers.get('Location'));
            const current = await this.ctx.storage.get<ActiveCall>('active');
            if (!current || current.sessionId !== active.sessionId || current.closing) {
                await this.hangup(callId); throw new RequestError('Voice start was cancelled.', 409);
            }
            current.callId = callId;
            await this.ctx.storage.put('active', current);
            const sdp = await readAnswer(created); // Reject a control channel even in an unexpected answer.
            // Server observes transcripts; browser cannot submit fabricated assistant replies to Supabase.
            const upgraded = await connectSideband(this.env, callId);
            const ws = upgraded.webSocket;
            if (!ws) throw new Error('Could not attach voice control');
            ws.accept();
            const attached = await this.ctx.storage.get<ActiveCall>('active');
            if (!attached || attached.sessionId !== active.sessionId || attached.closing) { ws.close(); throw new RequestError('Voice start was cancelled.', 409); }
            this.sideband = ws;
            ws.addEventListener('message', event => {
                this.events = this.events.then(() => this.onEvent(active.sessionId, event.data)).catch(() => {
                    // Fail closed on persistence/control errors. Alarm retries pending transcripts.
                    this.ctx.waitUntil(this.end(active.sessionId));
                });
                this.ctx.waitUntil(this.events);
            });
            const disconnected = () => { this.ctx.waitUntil(this.end(active.sessionId)); };
            ws.addEventListener('close', disconnected); ws.addEventListener('error', disconnected);
            return Response.json({ protocol: VOICE_PROTOCOL, sdp, sessionId: active.sessionId, deadline: active.deadline, voice: input.voice, usage: await this.usageSnapshot() });
        } catch (error) {
            await this.end(active.sessionId);
            throw error;
        }
    }

    /** Read-only authenticated stream; no provider commands or session configuration cross this boundary. */
    private openEvents(sessionId: string): Response {
        if (this.feed) throw new RequestError('Voice updates are already connected.', 409);
        const body = new ReadableStream<Uint8Array>({
            start: controller => {
                this.feed = { sessionId, controller };
                controller.enqueue(new TextEncoder().encode('{"type":"voice.ready"}\n'));
            },
            cancel: () => {
                if (this.feed?.sessionId === sessionId) this.feed = null;
                this.ctx.waitUntil(this.end(sessionId));
            },
        }, { highWaterMark: 32 });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
    }

    private publish(sessionId: string, event: Record<string, unknown>): void {
        const safe = displayEvent(event), feed = this.feed;
        if (!safe || !feed || feed.sessionId !== sessionId) return;
        if ((feed.controller.desiredSize ?? 0) <= 0) throw new Error('Voice display stream is not consuming updates');
        feed.controller.enqueue(new TextEncoder().encode(JSON.stringify(safe) + '\n'));
    }

    /** Reserve before issuing inference, and allow only one server-authorized response at a time. */
    private async requestReply(sessionId: string): Promise<void> {
        let command: { type: string; response: { metadata: { server_turn: string }; max_output_tokens: number } } | undefined;
        await this.ctx.storage.transaction(async storage => {
            const active = await storage.get<ActiveCall>('active');
            if (!active || active.sessionId !== sessionId || active.closing || active.reply || !active.queuedInput) return;
            if (Date.now() >= Math.min(active.deadline, active.lease, active.activity + IDLE_MS))
                throw new RequestError('Voice session expired. Start a new call to continue.', 409);
            const day = utcDay(), key = `usage:${day}`;
            const budget = await storage.get<DailyUsage>(key) ?? { tokens: 0, estimatedTokens: 0 };
            const reservedTokens = replyReservation(active.instructions ?? '');
            if (allowance(budget, tokenLimit(this.env.VOICE_DAILY_TOKEN_LIMIT)).remainingTokens < reservedTokens)
                throw new RequestError('Not enough voice allowance for another reply. Text chat is still available.', 429);
            active.reply = { requestId: crypto.randomUUID(), day, reservedTokens };
            active.queuedInput = undefined;
            budget.reservedTokens = (budget.reservedTokens ?? 0) + reservedTokens;
            await storage.put({ active, [key]: budget });
            command = { type: 'response.create', response: { metadata: { server_turn: active.reply.requestId }, max_output_tokens: OUTPUT_TOKENS } };
        });
        if (command) {
            if (!this.sideband) throw new Error('Voice control unavailable');
            this.sideband.send(JSON.stringify(command));
        }
    }

    private async onEvent(sessionId: string, raw: unknown, flush = true): Promise<void> {
        if (typeof raw !== 'string' || raw.length > 100000) return;
        const observed = await this.ctx.storage.get<ActiveCall>('active');
        if (!observed || observed.sessionId !== sessionId) return;
        const event = JSON.parse(raw);
        if (event.type === 'response.created' || event.type === 'response.done') {
            const reply = observed.reply;
            const responseId = event.response?.id;
            const duplicateDone = event.type === 'response.done' && typeof responseId === 'string'
                && observed.usage?.[`response:${responseId}`]?.tokens != null;
            if (!duplicateDone && (!reply || (reply.responseId && reply.responseId !== responseId)
                || ((event.type === 'response.created' || !reply.responseId) && event.response?.metadata?.server_turn !== reply.requestId))) {
                // Record any unexpected provider work before terminating; never count it as free.
                const unexpected = providerUsage(event);
                if (unexpected) await this.recordUsage(sessionId, unexpected);
                this.ctx.waitUntil(this.end(sessionId, 'Voice control could not be verified. Please start a new call.'));
                return;
            }
            if (!duplicateDone && reply) {
                reply.responseId = responseId;
                await this.ctx.storage.put('active', observed);
            }
        }
        const usage = providerUsage(event);
        if (usage) {
            await this.recordUsage(sessionId, usage);
            const budget = await this.usageSnapshot();
            if (budget.usedTokens >= budget.limitTokens || (usage.complete && usage.tokens === null)) {
                this.ctx.waitUntil(this.end(sessionId, budget.usedTokens >= budget.limitTokens ? limitMessage(budget.resetsAt)
                    : 'Voice usage could not be verified. Please try again later; text chat is still available.'));
                return;
            }
        }
        let active = await this.ctx.storage.get<ActiveCall>('active');
        if (!active || active.sessionId !== sessionId) return;
        const itemId = event.item_id ?? event.item?.id;
        if (['input_audio_buffer.speech_started', 'conversation.item.added', 'conversation.item.created', 'response.output_item.added'].includes(event.type)
            && typeof itemId === 'string' && this.itemTimes.size < 100 && !this.itemTimes.has(itemId)) this.itemTimes.set(itemId, new Date().toISOString());
        if (event.type === 'error') { this.ctx.waitUntil(this.end(sessionId)); return; }
        if (event.type === 'session.updated' && (event.session?.instructions !== active.instructions
            || event.session?.max_output_tokens !== OUTPUT_TOKENS || !Array.isArray(event.session?.tools) || event.session.tools.length !== 0
            || !(event.session?.model === this.env.VOICE_MODEL || String(event.session?.model).startsWith(`${this.env.VOICE_MODEL}-`))
            || event.session?.truncation?.type !== 'retention_ratio'
            || event.session?.truncation?.token_limits?.post_instructions !== CONTEXT_TOKENS
            || event.session?.audio?.input?.turn_detection?.create_response !== false
            || event.session?.audio?.input?.transcription?.model !== 'gpt-4o-mini-transcribe'
            || event.session?.audio?.output?.voice !== active.voice)) {
            this.ctx.waitUntil(this.end(sessionId)); return;
        }
        this.publish(sessionId, event);
        if (event.type === 'input_audio_buffer.committed' && !active.committedInputs?.includes(event.item_id)) {
            if ((active.committedInputs?.length ?? 0) >= 40) { this.ctx.waitUntil(this.end(sessionId)); return; }
            active.committedInputs = [...(active.committedInputs ?? []), event.item_id];
            active.queuedInput = event.item_id;
            await this.ctx.storage.put('active', active);
        }
        if (!active.closing && active.queuedInput && !active.reply) {
            try { await this.requestReply(sessionId); }
            catch (error) {
                this.ctx.waitUntil(this.end(sessionId, error instanceof RequestError ? error.message : undefined));
                return;
            }
            // requestReply persists a reservation; never overwrite it with the earlier snapshot.
            active = await this.ctx.storage.get<ActiveCall>('active');
            if (!active || active.sessionId !== sessionId) return;
        }
        if (event.type === 'input_audio_buffer.speech_started' || event.type === 'output_audio_buffer.stopped') {
            if (event.type === 'output_audio_buffer.stopped') active.unplayed = [];
            active.activity = Date.now(); await this.ctx.storage.put('active', active); await this.schedule(active);
        }
        const item = transcript(event);
        if (!item) return;
        if (item.interrupted || ((active.closing || this.ending) && item.role === 'assistant')) this.interrupted.add(item.itemId);
        if (this.receivedItems.size >= 40 && !this.receivedItems.has(item.itemId)) { this.ctx.waitUntil(this.end(sessionId)); return; }
        this.receivedItems.add(item.itemId);
        if (item.role === 'assistant' && !item.interrupted) {
            active.unplayed = [...new Set([...(active.unplayed ?? []), item.itemId])];
            await this.ctx.storage.put('active', active);
        }
        const interrupted = this.interrupted.has(item.itemId);
        const key = `outbox:${sessionId}:${item.itemId}`;
        const previous = await this.ctx.storage.get<Message>(key);
        const message: Message = { user_id: active.userId, conversation_id: active.conversationId, session_id: sessionId,
            item_id: item.itemId, role: item.role, content: interrupted ? '[Coach reply interrupted; unplayed text omitted.]' : item.content,
            interrupted, context: active.context, created_at: previous?.created_at ?? this.itemTimes.get(item.itemId) ?? new Date().toISOString() };
        await this.ctx.storage.put(key, message);
        if (flush) await this.flush();
    }

    private async recordUsage(sessionId: string, item: NonNullable<ReturnType<typeof providerUsage>>): Promise<void> {
        await this.ctx.storage.transaction(async storage => {
            const active = await storage.get<ActiveCall>('active');
            if (!active || active.sessionId !== sessionId) return;
            const entries = active.usage ??= {};
            const previous = entries[item.key];
            if (previous && previous.tokens !== null) return; // Redelivery is not new usage.
            if (!previous && Object.keys(entries).length >= 100) throw new Error('Voice usage event limit reached');
            const isReply = item.key.startsWith('response:') && active.reply?.responseId === item.key.slice(9);
            const day = previous?.day ?? (isReply ? active.reply!.day : utcDay());
            entries[item.key] = { day, tokens: item.tokens };
            if (item.tokens !== null) {
                const key = `usage:${day}`;
                const budget = await storage.get<DailyUsage>(key) ?? { tokens: 0, estimatedTokens: 0 };
                budget.tokens += item.tokens;
                await storage.put(key, budget);
            }
            if (isReply && item.complete && item.tokens !== null) {
                const key = `usage:${active.reply!.day}`;
                const budget = await storage.get<DailyUsage>(key) ?? { tokens: 0, estimatedTokens: 0 };
                budget.reservedTokens = Math.max(0, (budget.reservedTokens ?? 0) - active.reply!.reservedTokens);
                await storage.put(key, budget);
                active.reply = undefined;
            }
            await storage.put('active', active);
        });
    }

    private async settleUnreportedUsage(sessionId: string): Promise<void> {
        // Don't let ending/disconnecting before response.done bypass the allowance.
        // Known completed usage stays exact; unreported in-flight work gets a conservative reserve.
        await this.ctx.storage.transaction(async storage => {
            const active = await storage.get<ActiveCall>('active');
            if (!active || active.sessionId !== sessionId) return;
            if (active.reply) {
                const key = `usage:${active.reply.day}`;
                const budget = await storage.get<DailyUsage>(key) ?? { tokens: 0, estimatedTokens: 0 };
                budget.reservedTokens = Math.max(0, (budget.reservedTokens ?? 0) - active.reply.reservedTokens);
                // If the socket closes before even response.created, inference was still authorized.
                if (!active.reply.responseId) budget.estimatedTokens += active.reply.reservedTokens;
                await storage.put(key, budget);
                active.reply = undefined;
            }
            for (const entry of Object.values(active.usage ?? {})) {
                if (entry.tokens !== null) continue;
                const key = `usage:${entry.day}`;
                const budget = await storage.get<DailyUsage>(key) ?? { tokens: 0, estimatedTokens: 0 };
                budget.estimatedTokens += UNREPORTED_TOKENS;
                entry.tokens = UNREPORTED_TOKENS;
                await storage.put(key, budget);
            }
            await storage.put('active', active);
        });
    }

    private async flush(): Promise<void> {
        if (this.flushing) { await this.flushing; return this.flush(); }
        this.flushing = this.flushBatch().finally(() => { this.flushing = null; });
        return this.flushing;
    }

    private async flushBatch(): Promise<void> {
        const pending = await this.ctx.storage.list<Message>({ prefix: 'outbox:', limit: 40 });
        if (!pending.size) return;
        const client = admin(this.env);
        for (const [key, row] of pending) {
            const saved = await client.from('coach_voice_messages').upsert(row, { onConflict: 'user_id,session_id,item_id' });
            if (saved.error) {
                // The owner deleted their conversation/user: never recreate it or retry forever.
                if (saved.error.code === '23503') { await this.ctx.storage.delete(key); continue; }
                throw new Error('Transcript persistence unavailable');
            }
            const latest = await this.ctx.storage.get<Message>(key);
            if (JSON.stringify(latest) === JSON.stringify(row)) await this.ctx.storage.delete(key);
        }
    }

    private async schedule(active: ActiveCall): Promise<void> {
        await this.ctx.storage.setAlarm(Math.min(active.deadline, active.lease, active.activity + IDLE_MS));
    }

    async alarm(): Promise<void> {
        // Re-arm before I/O: provider/database outages must not exhaust automatic retry attempts.
        await this.ctx.storage.setAlarm(Date.now() + 15000);
        const active = await this.ctx.storage.get<ActiveCall>('active');
        if (active && (active.closing || !this.sideband || Date.now() >= Math.min(active.deadline, active.lease, active.activity + IDLE_MS))) {
            await this.end(active.sessionId);
        } else if (active) await this.schedule(active);
        await this.flush();
        if (!await this.ctx.storage.get('active') && !(await this.ctx.storage.list({ prefix: 'outbox:' })).size) await this.ctx.storage.deleteAlarm();
    }

    private async hangup(callId: string): Promise<void> {
        const response = await provider(this.env, `realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST' });
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error('Hangup retry required');
    }

    private async end(sessionId: string, message?: string): Promise<void> {
        if (message) await this.ctx.storage.put('lastEnd', { sessionId, message });
        if (this.ending) return this.ending;
        this.ending = this.endCall(sessionId).finally(() => { this.ending = null; });
        return this.ending;
    }

    private async endCall(sessionId: string): Promise<void> {
        const active = await this.ctx.storage.get<ActiveCall>('active');
        if (!active || active.sessionId !== sessionId) return;
        active.closing = true;
        await this.ctx.storage.put('active', active);
        await this.ctx.storage.setAlarm(Date.now() + 15000);
        await this.events;
        // Ending mid-reply (including after a coordinator restart) must not save unplayed advice as heard.
        const pending = await this.ctx.storage.get<ActiveCall>('active');
        for (const itemId of pending?.unplayed ?? [])
            await this.onEvent(sessionId, JSON.stringify({ type: 'conversation.item.truncated', item_id: itemId }), false);
        if (active.callId) await this.hangup(active.callId);
        await this.events;
        this.sideband?.close(); this.sideband = null;
        if (this.feed?.sessionId === sessionId) { this.feed.controller.close(); this.feed = null; }
        await this.settleUnreportedUsage(sessionId);
        await this.ctx.storage.delete('active');
        await this.flush();
        if (!await this.ctx.storage.get('active') && !(await this.ctx.storage.list({ prefix: 'outbox:' })).size) await this.ctx.storage.deleteAlarm();
    }
}
