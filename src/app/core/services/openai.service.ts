import { Injectable, inject } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { DemoModeService } from './demo-mode.service';

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
    private demo = inject(DemoModeService);

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
        if (this.demo.active()) return cannedDemoResponse();

        // functions.invoke() buffers the whole response; streaming needs a raw
        // fetch against the same function endpoint with the session JWT.
        const url = `${environment.supabaseUrl}/functions/v1/ai-report`;

        return new Observable<string>(subscriber => {
            const controller = new AbortController();
            let buffer = '';

            // Fetch a FRESH access token right before the request. getSession()
            // auto-refreshes an expired token; reading the cached authToken()
            // signal could send a stale/expired JWT ("Invalid or expired token").
            (async () => {
                const { data: { session } } = await this.supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) {
                    subscriber.error(new Error('Not authenticated.'));
                    return;
                }

                await fetch(url, {
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
            })();

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

// ── Demo canned responses ─────────────────────────────────────────────────

const DEMO_RESPONSES = [
`## Verdict

**B+** — You're building consistency, but leaving money on the table by cutting winners too early.

## What worked

- Respected max daily loss limit on 4 of 5 days — this alone kept the week from being a disaster.
- MNQ long setups were clean: entries timed off the 15-minute consolidation break, not the initial spike.
- Post-2PM discipline improved versus last week; only 1 of 12 trades was taken in the afternoon chop window.

## What cost you

- Average winner (31 pts) is 18% smaller than your average loser (38 pts) — you're cutting profits before target while letting losses run to the stop.
- Tuesday's revenge sequence: 3 trades placed within 20 minutes of each other after a stop-out. All three were losers. That single sequence erased 60% of Monday's gain.
- NQ size was 2× your normal MNQ risk on a lower-conviction setup. Inconsistent sizing hides your actual edge.

## Tomorrow's focus

- [ ] Set a 1:1.5 minimum R:R at entry and do not close the trade manually before price hits target or stop.`,

`## Verdict

**C+** — Win rate held above 50% but profit factor collapsed to 0.91. You're winning often but not enough on the wins.

## What worked

- Identified the trend correctly 4 of 5 days — your directional bias is sound.
- Held through a 12-point pullback on Wednesday's MNQ long and was rewarded with a 44-point winner. That kind of patience needs to become the rule, not the exception.
- No trades on Thursday (low-volatility, pre-FOMC) — the best trade is sometimes no trade.

## What cost you

- Three breakeven exits in a row on Tuesday cost you $127 in commissions with zero P&L to show. BE stops are useful in textbook — in your data they correlate with losses: the price dips to breakeven, stops you out, then runs to your target.
- Your setup win rate on ES (38%) lags MNQ (61%) by a wide margin. You may be pattern-matching across instruments that trade differently. Consider removing ES until the edge is clearer.
- Added a 3rd contract on a failed breakout — max size on your lowest-conviction setup of the week.

## Tomorrow's focus

- [ ] Trade MNQ exclusively and skip any setup that you can't grade A or B before entry.`,

`## Verdict

**A−** — Best week in two months. The equity curve shows exactly what disciplined trading looks like: steady gains, one controlled stop, no disasters.

## What worked

- Profit factor of 2.4 — for every dollar lost you made $2.40. This is what the playbook is designed to produce.
- You stopped after hitting your daily goal on Monday and Wednesday instead of pressing. Both afternoons were choppy; sitting out was the right call.
- Rules checklist compliance jumped to 86% (up from 61% three weeks ago). The discipline metrics are a leading indicator — expect equity to follow.

## What cost you

- Friday's short setup was counter-trend against a clear bull structure. The technical setup was fine but the macro context argued against it. It was a small loss, but context awareness would have kept you out entirely.
- Position sizing dipped to 1 contract on your two best setups of the week. When the edge is obvious, size should reflect that conviction.

## Tomorrow's focus

- [ ] Before each entry, write the macro context (bull/bear/neutral) in the journal and only take setups that align with it.`,
];

let _demoResponseIndex = 0;

function cannedDemoResponse(): Observable<string> {
    const text = DEMO_RESPONSES[_demoResponseIndex % DEMO_RESPONSES.length];
    _demoResponseIndex++;
    const tokens = text.split(/(?<=\s)|(?=\s)/g).filter(t => t.length > 0);

    return new Observable<string>(subscriber => {
        let cancelled = false;
        let i = 0;

        function emitNext() {
            if (cancelled || i >= tokens.length) {
                if (!cancelled) subscriber.complete();
                return;
            }
            subscriber.next(tokens[i++]);
            setTimeout(emitNext, 18 + Math.random() * 20);
        }

        setTimeout(emitNext, 120); // brief delay mimics network round-trip
        return () => { cancelled = true; };
    });
}

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
