import type OpenAI from 'npm:openai@7.9.0';
const OPENAI_MODEL = 'gpt-4o';
const MAX_STREAM_TOKENS = 2000;

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

export function buildParams(type: string, payload: any): OpenAI.Chat.ChatCompletionCreateParams | null {
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
