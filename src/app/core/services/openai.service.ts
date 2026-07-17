import { Injectable, inject } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

/**
 * All AI calls go through the ai-report Supabase Edge Function — the
 * Anthropic key exists only as a function secret and never reaches the
 * client (web or Electron). The function verifies the caller's JWT,
 * enforces the lifetime plan server-side, and rate-limits per user.
 */
@Injectable({
    providedIn: 'root'
})
export class OpenAiService {
    private auth = inject(AuthService);
    private supabase = inject(SupabaseService).client;

    constructor() {
        // Pre-Phase-3 Electron builds kept a user-pasted Anthropic key in
        // localStorage. Scrub any lingering copy — it is no longer used.
        localStorage.removeItem('anthropic_api_key');
    }

    /**
     * Historical name kept for template compatibility. There is no client
     * key anymore — this now answers "can this user use AI features?",
     * mirroring the Edge Function's server-side plan gate.
     */
    hasApiKey(): boolean {
        return this.auth.plan() === 'lifetime';
    }

    // ── Non-streaming helpers ─────────────────────────────────────────────────

    analyzeTrade(marketData: any[], tradeDetails: any): Observable<string> {
        return this.invokeReport('analyze-trade', { marketData, tradeDetails }, 'No analysis provided.');
    }

    analyzeImage(imageBase64: string, tradeDetails: any): Observable<string> {
        return this.invokeReport('analyze-image', { imageBase64, tradeDetails }, 'No analysis provided.');
    }

    predictMarket(candles: any[], symbol: string, timeframe: string): Observable<string> {
        return this.invokeReport('predict-market', { candles, symbol, timeframe }, 'No prediction generated.');
    }

    private invokeReport(type: string, payload: unknown, emptyMessage: string): Observable<string> {
        return from(this.callFunction(type, payload)).pipe(
            map(text => text || emptyMessage),
            catchError(err => {
                console.error('AI report error:', err);
                return throwError(() => (err instanceof Error ? err : new Error('AI request failed.')));
            })
        );
    }

    private async callFunction(type: string, payload: unknown): Promise<string> {
        const { data, error } = await this.supabase.functions.invoke('ai-report', {
            body: { type, payload }
        });
        if (error) {
            // FunctionsHttpError carries the function's JSON body (plan/rate-limit
            // messages) on its context Response — surface that to the user.
            const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
            throw new Error(body?.error || 'AI request failed.');
        }
        return data?.text ?? '';
    }

    // ── Streaming ─────────────────────────────────────────────────────────────

    streamAnalysis(messages: any[], maxTokens = 1200): Observable<string> {
        const token = this.auth.authToken();
        if (!token) return throwError(() => new Error('Not authenticated.'));

        // functions.invoke() buffers the whole response; streaming needs a raw
        // fetch against the same function endpoint with the session JWT.
        const url = `${environment.supabaseUrl}/functions/v1/ai-report`;

        return new Observable<string>(subscriber => {
            const controller = new AbortController();
            let buffer = '';

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'apikey': environment.supabasePublishableKey,
                },
                body: JSON.stringify({
                    type: 'stream-analysis',
                    payload: { messages, maxTokens },
                }),
                signal: controller.signal,
            }).then(async res => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    subscriber.error(new Error(body.error || `HTTP ${res.status}`));
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
}
