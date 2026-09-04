import { RequestError } from './request-body.ts';

export const MAX_AI_BODY_BYTES = 4 * 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
function requireValue(valid: unknown, message: string): asserts valid {
    if (!valid) throw new RequestError(message);
}
function text(value: unknown, max = 40_000): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function image(value: unknown): boolean {
    return typeof value === 'string' && value.length <= 3 * 1024 * 1024 &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function candles(value: unknown): void {
    requireValue(Array.isArray(value) && value.length > 0 && value.length <= 1000, 'Provide 1–1000 candles.');
    requireValue(value.every(c => object(c) && ['open', 'high', 'low', 'close', 'volume'].every(k =>
        typeof c[k] === 'number' && Number.isFinite(c[k])) &&
        ['string', 'number'].includes(typeof c.timestamp) && Number.isFinite(new Date(c.timestamp).getTime())), 'Invalid candle data.');
}

/** Reject invalid/expensive input BEFORE reserving quota or contacting OpenAI. */
export function validateAiBody(body: unknown): { type: string; payload: Record<string, any> } {
    requireValue(object(body) && object(body.payload), 'A report type and payload are required.');
    const { type, payload } = body;
    switch (type) {
        case 'stream-analysis': {
            requireValue(Array.isArray(payload.messages) && payload.messages.length > 0 && payload.messages.length <= 24, 'Provide 1–24 messages.');
            const max = payload.maxTokens ?? 1200;
            requireValue(Number.isInteger(max) && max > 0 && max <= 2000, 'maxTokens must be an integer between 1 and 2000.');
            let textSize = 0, imageCount = 0;
            const messages = payload.messages.map((message: unknown) => {
                requireValue(object(message) && ['system', 'user', 'assistant'].includes(message.role), 'Invalid message role.');
                const { role, content } = message;
                if (typeof content === 'string') {
                    requireValue(text(content), 'Message text is empty or too long.');
                    textSize += content.length;
                    return { role, content };
                }
                requireValue(role === 'user' && Array.isArray(content) && content.length > 0 && content.length <= 4, 'Invalid message content.');
                return { role, content: content.map((part: unknown) => {
                    requireValue(object(part), 'Invalid message part.');
                    if (part.type === 'text') {
                        requireValue(text(part.text), 'Message text is empty or too long.');
                        textSize += part.text.length;
                        return { type: 'text', text: part.text };
                    }
                    requireValue(part.type === 'image_url' && object(part.image_url) && image(part.image_url.url), 'Use an embedded PNG, JPEG or WebP image up to 3 MB (base64).');
                    imageCount++;
                    return { type: 'image_url', image_url: { url: part.image_url.url } };
                }) };
            });
            requireValue(textSize <= 80_000 && imageCount <= 2, 'Analysis input is too large.');
            requireValue(messages.some(m => m.role === 'user'), 'A user message is required.');
            return { type, payload: { messages, maxTokens: max } };
        }
        case 'analyze-trade':
            candles(payload.marketData);
            requireValue(object(payload.tradeDetails), 'Trade details are required.');
            break;
        case 'analyze-image':
            requireValue(image(`data:image/jpeg;base64,${payload.imageBase64}`), 'Provide a valid base64 chart image up to 3 MB.');
            requireValue(object(payload.tradeDetails), 'Trade details are required.');
            break;
        case 'predict-market':
            candles(payload.candles);
            requireValue(text(payload.symbol, 64) && text(payload.timeframe, 32), 'Symbol and timeframe are required.');
            break;
        default: throw new RequestError('Unknown report type.');
    }
    if (payload.tradeDetails) {
        requireValue(text(payload.tradeDetails.symbol, 64), 'Trade symbol is required.');
        const date = payload.tradeDetails.entryDate;
        requireValue(date == null || (text(date, 64) && Number.isFinite(Date.parse(date))), 'Invalid trade date.');
        for (const key of ['entryPrice', 'exitPrice', 'netPnl']) {
            const value = payload.tradeDetails[key];
            requireValue(value == null || (typeof value === 'number' && Number.isFinite(value)), 'Invalid trade price or P&L.');
        }
        requireValue(payload.tradeDetails.direction == null || ['long', 'short'].includes(payload.tradeDetails.direction), 'Invalid trade direction.');
    }
    return { type, payload };
}
