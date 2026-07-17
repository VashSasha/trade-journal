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
                    // The Edge Function returns { error } as JSON on 4xx/5xx.
                    // Map it to friendly copy so raw provider/config detail never
                    // reaches the UI, and the spinner always resolves to a message.
                    const body = await res.json().catch(() => ({}));
                    subscriber.error(new Error(friendlyStreamError(res.status, body?.error)));
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
                // Aborts are cooperative (unsubscribe / timeout) — end quietly.
                if (err?.name === 'AbortError') { subscriber.complete(); return; }
                // A genuine network failure (fetch rejects) — surface friendly copy.
                subscriber.error(new Error('Couldn\'t reach the AI service. Check your connection and try again.'));
            });

            return () => controller.abort();
        });
    }
}

/**
 * Milliseconds a consumer should wait for the FIRST streamed token before
 * treating the request as hung and aborting. Shared so every AI feature
 * enforces the same ceiling.
 */
export const AI_STREAM_TIMEOUT_MS = 45_000;

/** Generic fallback shown when no more specific message applies. */
export const AI_GENERIC_ERROR =
    'Something went wrong generating your analysis. Please try again.';

/**
 * Turn an Edge Function error (HTTP status + its `{ error }` body) into a
 * short, user-safe message. Never surfaces raw provider errors or keys.
 */
export function friendlyStreamError(status: number, rawError?: unknown): string {
    const raw = typeof rawError === 'string' ? rawError : '';

    // 429 — the function distinguishes the per-user daily cap from an
    // upstream "busy" throttle; keep both distinct for the user.
    if (status === 429) {
        return /daily ai limit|limit reached|quota resets/i.test(raw)
            ? "You've hit today's AI limit — resets tomorrow."
            : 'The AI service is busy, try again in a minute.';
    }

    // Billing / quota / missing-config problems on our side — never leak the
    // provider detail (which can name keys or account state).
    if (status === 402 || status === 500 || /quota|billing|not configured|api key/i.test(raw)) {
        return 'AI is temporarily unavailable.';
    }

    // Plan gate (403) / auth (401) already return friendly, actionable copy
    // from the function — surface it verbatim when present.
    if (raw) return raw;

    return AI_GENERIC_ERROR;
}
