// ai-report — server-side OpenAI proxy for all AI features. The OpenAI
// key lives ONLY here (function secret); the client never sees it. This is
// also the server-side enforcement of the plan gate that planGuard('lifetime')
// only enforces client-side, plus a per-user daily rate limit.
//
// Secrets (set via `supabase secrets set`, never committed):
//   SB_SECRET_KEY      — Supabase secret API key (service role equivalent)
//   OPENAI_API_KEY     — OpenAI API key used for every completion
//   APP_ORIGIN         — production web origin allowed for CORS
//
// Request body: { type, payload }
//   'analyze-trade'   { marketData, tradeDetails }
//   'analyze-image'   { imageBase64, tradeDetails }
//   'predict-market'  { candles, symbol, timeframe }
//   'stream-analysis' { messages, maxTokens? }        → SSE response
// Non-streaming responses: { text: string }

import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SECRET_KEY = Deno.env.get('SB_SECRET_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

// Valid current OpenAI model — kept as a single constant so it can be
// retuned without touching call sites.
const OPENAI_MODEL = 'gpt-4o';
const DAILY_LIMIT = 10;
const MAX_STREAM_TOKENS = 2000;

const ALLOWED_ORIGINS = new Set(['http://localhost:4200', APP_ORIGIN].filter(Boolean));

const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function corsHeaders(origin: string | null): Record<string, string> {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
    };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

// ── prompt builders (moved verbatim from the client service) ─────────────

function formatCandles(candles: any[]): string {
    return candles.map((c) =>
        `${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volume}`
    ).join('\n');
}

function tradeAnalysisPrompt(candles: any[], trade: any): string {
    const candleStr = candles.map((c) =>
        `[${new Date(c.timestamp).toISOString().substr(11, 5)}] O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`
    ).join('\n');

    return `Analyze this trade:
Symbol: ${trade.symbol}
Direction: ${trade.direction}
Entry: ${trade.entryPrice} @ ${trade.entryDate}
Exit: ${trade.exitPrice}
PnL: ${trade.netPnl}

Market Data (5-minute Key Candles):
${candleStr}

1. Identify the likely setup or market structure.
2. Evaluate the entry timing based on the candles provided.
3. Did the trader follow good risk principles?
4. Verdict: Good Trade or Bad Trade (process-wise)?`;
}

const IMAGE_ANALYSIS_SYSTEM = `You are an expert quantitative analyst and professional technical trader.

Your task is to analyze a trading chart and produce a complete, actionable trading plan.

INTERNAL ANALYSIS (DO NOT OUTPUT):
- Identify the active trading session (Asia, London, New York).
- Determine market structure (trend, HH/HL or LH/LL).
- Identify key support and resistance levels.
- Analyze volume behavior (confirming or weakening).
- Risk management: stop loss MUST be ≤ 20 points from entry. If not possible, No Trade only.

OUTPUT (valid Markdown only): Primary Trade Plan + Alternative Scenario, OR No Trade Scenario.
Use ## headings. No extra commentary outside the structure.`;

// ── request → OpenAI chat-completion params ───────────────────────────────
//
// OpenAI differs from Anthropic in two ways handled here:
//   • the system prompt is a message with role 'system' inside `messages`,
//     not a separate top-level `system` field;
//   • images are `{ type: 'image_url', image_url: { url } }` content parts,
//     not Anthropic's `{ type: 'image', source: {...} }`.

function buildParams(type: string, payload: any): OpenAI.Chat.ChatCompletionCreateParams | null {
    switch (type) {
        case 'analyze-trade':
            return {
                model: OPENAI_MODEL,
                max_tokens: 1000,
                messages: [
                    { role: 'system', content: 'You are an expert trading mentor. Analyze the provided trade data and market context (OHLCV candles). Provide constructive feedback on the entry, risk management, and outcome. Be valid, critical, and encouraging.' },
                    { role: 'user', content: tradeAnalysisPrompt(payload.marketData ?? [], payload.tradeDetails ?? {}) },
                ],
            };
        case 'analyze-image':
            return {
                model: OPENAI_MODEL,
                max_tokens: 1000,
                messages: [
                    { role: 'system', content: IMAGE_ANALYSIS_SYSTEM },
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${payload.imageBase64}` } },
                            { type: 'text', text: `Analyze this trade: Symbol: ${payload.tradeDetails?.symbol}, Direction: ${payload.tradeDetails?.direction}, PnL: ${payload.tradeDetails?.netPnl}.` },
                        ],
                    },
                ],
            };
        case 'predict-market':
            return {
                model: OPENAI_MODEL,
                max_tokens: 1200,
                messages: [
                    { role: 'system', content: 'You are a professional price action analyst and market forecaster. Analyze market data and provide actionable predictions with clear reasoning.' },
                    {
                        role: 'user',
                        content: `Symbol: ${payload.symbol}\nTimeframe: ${payload.timeframe}\nBars Analyzed: ${payload.candles?.length ?? 0}\n\nRecent Market Data:\n${formatCandles(payload.candles ?? [])}\n\nBased on this ${payload.timeframe} chart data, please provide:\n\n1. **Current Market Structure**: Identify the trend (bullish/bearish/ranging) and key price levels\n2. **Support & Resistance**: Identify immediate support and resistance zones\n3. **Market Prediction**: What is the most likely price direction in the next few bars?\n4. **Trade Setup**: If there's a high-probability setup, describe entry, stop loss, and target\n5. **Risk Assessment**: What could invalidate this prediction?\n\nBe specific with price levels and reasoning.`,
                    },
                ],
            };
        case 'stream-analysis': {
            const messages: any[] = Array.isArray(payload.messages) ? payload.messages : [];
            // The client already sends messages OpenAI-shaped — the system
            // prompt is a role:'system' message in the array — so pass through.
            if (messages.length === 0) return null;
            return {
                model: OPENAI_MODEL,
                max_tokens: Math.min(Number(payload.maxTokens) || 1200, MAX_STREAM_TOKENS),
                messages,
            };
        }
        default:
            return null;
    }
}

// ── handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'));

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, cors);
    }

    // 1. Verify the caller's Supabase JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Missing Authorization header' }, 401, cors);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) {
        return json({ error: 'Invalid or expired token' }, 401, cors);
    }
    const user = userData.user;

    // 2. Server-side plan gate: AI reports are a paid feature. Premium and
    //    lifetime share the same feature set, so both are allowed.
    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single();
    if (profileError || !profile) {
        return json({ error: 'Profile not found' }, 404, cors);
    }
    if (profile.plan !== 'premium' && profile.plan !== 'lifetime') {
        return json(
            { error: 'AI reports require a paid plan. Upgrade to unlock this feature.' },
            403,
            cors,
        );
    }

    // 3. Rate limit: max DAILY_LIMIT requests per user per day (atomic).
    const { data: usageCount, error: usageError } = await admin
        .rpc('increment_ai_usage', { p_user_id: user.id });
    if (usageError) {
        return json({ error: 'Failed to check usage limit' }, 500, cors);
    }
    if ((usageCount as number) > DAILY_LIMIT) {
        return json(
            { error: `Daily AI limit reached (${DAILY_LIMIT} requests). Your quota resets at midnight UTC — see you tomorrow!` },
            429,
            cors,
        );
    }

    // 4. Parse and validate the request.
    let type = '';
    let payload: any = {};
    try {
        const body = await req.json();
        type = body?.type;
        payload = body?.payload ?? {};
    } catch {
        return json({ error: 'Invalid JSON body' }, 400, cors);
    }

    const params = buildParams(type, payload);
    if (!params) {
        return json({ error: `Unknown or invalid report type: ${type}` }, 400, cors);
    }

    // Fail fast and loud if the deployment is missing its OpenAI secret —
    // otherwise the SDK error surfaces as an opaque upstream failure.
    if (!OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY secret is not set');
        return json({ error: 'AI service is not configured (missing API key).' }, 500, cors);
    }

    // 5. Call OpenAI.
    try {
        if (type === 'stream-analysis') {
            // Open the stream and pull the FIRST chunk before flushing the
            // 200 — an invalid model or auth failure throws here and is caught
            // below as a JSON 4xx/5xx, instead of hanging a "pending" request
            // after the event-stream headers have already gone out.
            const stream = await openai.chat.completions.create({ ...params, stream: true });
            const iterator = stream[Symbol.asyncIterator]();
            const first = await iterator.next();

            const encoder = new TextEncoder();
            // Translate each OpenAI chunk into the Anthropic-shaped SSE event
            // the existing client parser reads (content_block_delta /
            // message_stop) so the client stays untouched.
            const emitDelta = (controller: ReadableStreamDefaultController, chunk: any) => {
                const text = chunk?.choices?.[0]?.delta?.content ?? '';
                if (text) {
                    const event = { type: 'content_block_delta', delta: { type: 'text_delta', text } };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
            };
            const readable = new ReadableStream({
                async start(controller) {
                    try {
                        if (!first.done) emitDelta(controller, first.value);
                        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
                            emitDelta(controller, next.value);
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`));
                        controller.close();
                    } catch (err) {
                        controller.error(err);
                    }
                },
            });
            return new Response(readable, {
                headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
            });
        }

        const completion = await openai.chat.completions.create(params);
        const text = completion.choices[0]?.message?.content ?? '';
        return json({ text }, 200, cors);
    } catch (err) {
        console.error('OpenAI API error:', err);
        const status = (err as { status?: number })?.status;
        // Surface rate limiting distinctly; hide upstream details otherwise.
        if (status === 429) {
            return json({ error: 'The AI service is busy right now. Please try again in a minute.' }, 429, cors);
        }
        return json({ error: 'AI request failed. Please try again.' }, 502, cors);
    }
});
