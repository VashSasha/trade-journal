import { Injectable, inject, signal, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const CLAUDE_MODEL   = 'claude-opus-4-7';
const CLAUDE_VERSION = '2023-06-01';
const LOCAL_KEY      = 'anthropic_api_key'; // Electron-only: key stored locally

@Injectable({
    providedIn: 'root'
})
export class OpenAiService {
    private http = inject(HttpClient);
    private auth = inject(AuthService);

    /**
     * Web: the Anthropic key lives server-side (ai-proxy worker) and never
     * reaches the browser — AI calls go through the proxy with a Bearer session
     * JWT. Electron (interim): key kept in localStorage, Anthropic called directly.
     */
    private get isElectron(): boolean {
        return !!(typeof window !== 'undefined' && (window as any).electronAPI?.isElectron);
    }

    /** Reactive "a key is configured" state — drives @if gating in templates. */
    private hasKeySig = signal<boolean>(false);

    constructor() {
        if (this.isElectron) {
            this.hasKeySig.set(!!localStorage.getItem(LOCAL_KEY));
        } else {
            // Re-check server-side key status whenever the session token changes.
            effect(() => {
                const token = this.auth.authToken();
                if (token) this.refreshKeyStatus(token);
                else this.hasKeySig.set(false);
            });
        }
    }

    hasApiKey(): boolean {
        return this.hasKeySig();
    }

    /** Save (web: store server-side via proxy; Electron: localStorage). */
    async saveApiKey(key: string): Promise<void> {
        const trimmed = key.trim();
        if (!trimmed) throw new Error('API key is empty.');

        if (this.isElectron) {
            localStorage.setItem(LOCAL_KEY, trimmed);
            this.hasKeySig.set(true);
            return;
        }
        const res = await fetch(`${environment.aiProxyUrl}/key`, {
            method: 'POST',
            headers: this.proxyHeaders(true),
            body: JSON.stringify({ apiKey: trimmed }),
        });
        if (!res.ok) throw new Error('Failed to save API key.');
        this.hasKeySig.set(true);
    }

    /** Remove the stored key (web: server-side; Electron: localStorage). */
    async clearApiKey(): Promise<void> {
        if (this.isElectron) {
            localStorage.removeItem(LOCAL_KEY);
            this.hasKeySig.set(false);
            return;
        }
        const res = await fetch(`${environment.aiProxyUrl}/key`, {
            method: 'DELETE',
            headers: this.proxyHeaders(),
        });
        if (!res.ok) throw new Error('Failed to remove API key.');
        this.hasKeySig.set(false);
    }

    private async refreshKeyStatus(token: string): Promise<void> {
        try {
            const res = await fetch(`${environment.aiProxyUrl}/key/status`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            this.hasKeySig.set(res.ok && (await res.json()).hasKey === true);
        } catch {
            this.hasKeySig.set(false);
        }
    }

    private proxyHeaders(json = false): Record<string, string> {
        const token = this.auth.authToken();
        const h: Record<string, string> = {};
        if (token) h['Authorization'] = `Bearer ${token}`;
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }

    /** POST a Claude messages body — through the proxy (web) or direct (Electron). */
    private postMessages(body: any): Observable<any> {
        if (this.isElectron) {
            const apiKey = localStorage.getItem(LOCAL_KEY);
            if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));
            return this.http.post<any>(environment.anthropicApiUrl, body, { headers: this.buildHeaders(apiKey) });
        }
        const token = this.auth.authToken();
        if (!token) return throwError(() => new Error('Not authenticated.'));
        return this.http.post<any>(`${environment.aiProxyUrl}/v1/messages`, body, {
            headers: new HttpHeaders({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }),
        });
    }

    // ── Non-streaming helpers ─────────────────────────────────────────────────

    analyzeTrade(marketData: any[], tradeDetails: any): Observable<string> {
        const prompt = this.constructPrompt(marketData, tradeDetails);

        const body = {
            model: CLAUDE_MODEL,
            max_tokens: 1000,
            system: 'You are an expert trading mentor. Analyze the provided trade data and market context (OHLCV candles). Provide constructive feedback on the entry, risk management, and outcome. Be valid, critical, and encouraging.',
            messages: [{ role: 'user', content: prompt }],
        };

        return this.postMessages(body).pipe(
            map(res => res.content?.[0]?.text || 'No analysis provided.'),
            catchError(err => {
                console.error('Claude API Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact Claude.'));
            })
        );
    }

    analyzeImage(imageBase64: string, tradeDetails: any): Observable<string> {
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

        return this.postMessages(body).pipe(
            map(res => res.content?.[0]?.text || 'No analysis provided.'),
            catchError(err => {
                console.error('Claude Vision Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact Claude.'));
            })
        );
    }

    predictMarket(candles: any[], symbol: string, timeframe: string): Observable<string> {
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

        return this.postMessages(body).pipe(
            map(res => res.content?.[0]?.text || 'No prediction generated.'),
            catchError(err => {
                console.error('Claude Market Prediction Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to generate market prediction.'));
            })
        );
    }

    // ── Streaming ─────────────────────────────────────────────────────────────

    streamAnalysis(messages: any[], maxTokens = 1200): Observable<string> {
        let url: string;
        let headers: Record<string, string>;

        if (this.isElectron) {
            const apiKey = localStorage.getItem(LOCAL_KEY);
            if (!apiKey) return throwError(() => new Error('Anthropic API key is missing.'));
            url = environment.anthropicApiUrl;
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': CLAUDE_VERSION,
                'anthropic-dangerous-direct-browser-access': 'true',
            };
        } else {
            const token = this.auth.authToken();
            if (!token) return throwError(() => new Error('Not authenticated.'));
            url = `${environment.aiProxyUrl}/v1/messages`;
            headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
        }

        return new Observable<string>(subscriber => {
            const controller = new AbortController();
            let buffer = '';

            // Extract system message — Claude takes it as a top-level param
            const systemMsg = messages.find(m => m.role === 'system');
            const chatMsgs  = messages.filter(m => m.role !== 'system');

            fetch(url, {
                method: 'POST',
                headers,
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
