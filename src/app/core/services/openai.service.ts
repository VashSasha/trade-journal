import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

const CLAUDE_MODEL   = 'claude-opus-4-7';
const CLAUDE_VERSION = '2023-06-01';

@Injectable({
    providedIn: 'root'
})
export class OpenAiService {
    private http = inject(HttpClient);

    private getApiKey(): string | null {
        return localStorage.getItem('anthropic_api_key');
    }

    saveApiKey(key: string): void {
        localStorage.setItem('anthropic_api_key', key);
    }

    hasApiKey(): boolean {
        return !!this.getApiKey();
    }

    // ── Non-streaming helpers ─────────────────────────────────────────────────

    analyzeTrade(marketData: any[], tradeDetails: any): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));

        const headers = this.buildHeaders(apiKey);
        const prompt  = this.constructPrompt(marketData, tradeDetails);

        const body = {
            model: CLAUDE_MODEL,
            max_tokens: 1000,
            system: 'You are an expert trading mentor. Analyze the provided trade data and market context (OHLCV candles). Provide constructive feedback on the entry, risk management, and outcome. Be valid, critical, and encouraging.',
            messages: [{ role: 'user', content: prompt }],
        };

        return this.http.post<any>(environment.anthropicApiUrl, body, { headers }).pipe(
            map(res => res.content?.[0]?.text || 'No analysis provided.'),
            catchError(err => {
                console.error('Claude API Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact Claude.'));
            })
        );
    }

    analyzeImage(imageBase64: string, tradeDetails: any): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));

        const headers = this.buildHeaders(apiKey);
        const body = {
            model: CLAUDE_MODEL,
            max_tokens: 1000,
            system: this.imageAnalysisSystemPrompt(),
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
                    { type: 'text', text: `Analyze this trade: Symbol: ${tradeDetails.symbol}, Direction: ${tradeDetails.direction}, PnL: ${tradeDetails.netPnl}.` }
                ]
            }]
        };

        return this.http.post<any>(environment.anthropicApiUrl, body, { headers }).pipe(
            map(res => res.content?.[0]?.text || 'No analysis provided.'),
            catchError(err => {
                console.error('Claude Vision Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact Claude.'));
            })
        );
    }

    predictMarket(candles: any[], symbol: string, timeframe: string): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));

        const headers  = this.buildHeaders(apiKey);
        const candleStr = this.formatCandles(candles);

        const body = {
            model: CLAUDE_MODEL,
            max_tokens: 1200,
            system: 'You are a professional price action analyst and market forecaster. Analyze market data and provide actionable predictions with clear reasoning.',
            messages: [{
                role: 'user',
                content: `Symbol: ${symbol}\nTimeframe: ${timeframe}\nBars Analyzed: ${candles.length}\n\nRecent Market Data:\n${candleStr}\n\nBased on this ${timeframe} chart data, please provide:\n\n1. **Current Market Structure**: Identify the trend (bullish/bearish/ranging) and key price levels\n2. **Support & Resistance**: Identify immediate support and resistance zones\n3. **Market Prediction**: What is the most likely price direction in the next few bars?\n4. **Trade Setup**: If there's a high-probability setup, describe entry, stop loss, and target\n5. **Risk Assessment**: What could invalidate this prediction?\n\nBe specific with price levels and reasoning.`
            }]
        };

        return this.http.post<any>(environment.anthropicApiUrl, body, { headers }).pipe(
            map(res => res.content?.[0]?.text || 'No prediction generated.'),
            catchError(err => {
                console.error('Claude Market Prediction Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to generate market prediction.'));
            })
        );
    }

    // ── Streaming ─────────────────────────────────────────────────────────────

    streamAnalysis(messages: any[], maxTokens = 1200): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));

        return new Observable<string>(subscriber => {
            const controller = new AbortController();
            let buffer = '';

            // Extract system message — Claude takes it as a top-level param
            const systemMsg = messages.find(m => m.role === 'system');
            const chatMsgs  = messages.filter(m => m.role !== 'system');

            fetch(environment.anthropicApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': CLAUDE_VERSION,
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: CLAUDE_MODEL,
                    max_tokens: maxTokens,
                    ...(systemMsg ? { system: systemMsg.content } : {}),
                    messages: chatMsgs,
                    stream: true,
                }),
                signal: controller.signal,
            }).then(async res => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    subscriber.error(new Error(body.error?.message || `HTTP ${res.status}`));
                    return;
                }

                const reader  = res.body!.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data: ')) continue;
                        const data = trimmed.slice(6);
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                                const token = parsed.delta.text;
                                if (token) subscriber.next(token);
                            } else if (parsed.type === 'message_stop') {
                                subscriber.complete();
                                return;
                            }
                        } catch { /* skip malformed chunks */ }
                    }
                }
                subscriber.complete();
            }).catch(err => {
                if (err.name !== 'AbortError') subscriber.error(err);
                else subscriber.complete();
            });

            return () => controller.abort();
        });
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private buildHeaders(apiKey: string): HttpHeaders {
        return new HttpHeaders({
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': CLAUDE_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true',
        });
    }

    private formatCandles(candles: any[]): string {
        return candles.map(c =>
            `${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volume}`
        ).join('\n');
    }

    private imageAnalysisSystemPrompt(): string {
        return `You are an expert quantitative analyst and professional technical trader.

Your task is to analyze a trading chart and produce a complete, actionable trading plan.

INTERNAL ANALYSIS (DO NOT OUTPUT):
- Identify the active trading session (Asia, London, New York).
- Determine market structure (trend, HH/HL or LH/LL).
- Identify key support and resistance levels.
- Analyze volume behavior (confirming or weakening).
- Risk management: stop loss MUST be ≤ 20 points from entry. If not possible, No Trade only.

OUTPUT (valid Markdown only): Primary Trade Plan + Alternative Scenario, OR No Trade Scenario.
Use ## headings. No extra commentary outside the structure.`;
    }

    private constructPrompt(candles: any[], trade: any): string {
        const candleStr = candles.map(c =>
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
}
