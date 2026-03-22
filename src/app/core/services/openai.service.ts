import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
export class OpenAiService {
    private apiUrl = 'https://api.openai.com/v1/chat/completions';
    private http = inject(HttpClient);

    private getApiKey(): string | null {
        return localStorage.getItem('openai_api_key');
    }

    saveApiKey(key: string): void {
        localStorage.setItem('openai_api_key', key);
    }

    hasApiKey(): boolean {
        return !!this.getApiKey();
    }

    analyzeTrade(marketData: any[], tradeDetails: any): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('OpenAI API Key is missing.'));

        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        });

        const prompt = this.constructPrompt(marketData, tradeDetails);

        const body = {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert trading mentor. Analyze the provided trade data and market context (OHLCV candles). Provide constructive feedback on the entry, risk management, and outcome. Be valid, critical, and encouraging.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7
        };

        return this.http.post<any>(this.apiUrl, body, { headers }).pipe(
            map(res => res.choices[0]?.message?.content || 'No analysis provided.'),
            catchError(err => {
                console.error('OpenAI API Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact OpenAI.'));
            })
        );
    }

    analyzeImage(imageBase64: string, tradeDetails: any): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('OpenAI API Key is missing.'));

        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        });

        const body = {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `
                    You are an expert quantitative analyst and professional technical trader.

                    Your task is to analyze OCR data extracted from a trading chart screenshot and produce a complete, actionable trading plan.
                    The OCR data may be imperfect or fragmented, so you must infer context and act as a high-level trading assistant.

                    You MUST perform internal analysis, but you MUST ONLY output the final result using VALID MARKDOWN.

                    DO NOT include your reasoning, analysis steps, or explanations outside the final structure.

                    ────────────────────────────
                    INTERNAL ANALYSIS REQUIREMENTS (DO NOT OUTPUT):
                    - Identify the active trading session (Asia, London, New York).
                    - Assess whether momentum is recent and session-driven.
                    - Determine market structure (trend, HH/HL or LH/LL).
                    - Identify key support and resistance levels.
                    - Analyze volume behavior (confirming or weakening).
                    - Form a high-probability trade thesis using confluence.
                    - Risk management rule: stop loss MUST be ≤ 20 points from entry.
                    If not possible, return a No Trade scenario only.
                    ────────────────────────────

                    FINAL OUTPUT RULES (MANDATORY):
                    - Use ONLY valid Markdown.
                    - Use Markdown headings ('##') — NEVER use square brackets for titles.
                    - Use blank lines between sections.
                    - Lists MUST be proper Markdown bullet lists.
                    - Do NOT embed examples inside the output.
                    - Do NOT add extra commentary.
                    - Output ONLY ONE of the following:
                    1) Primary Trade Plan + Alternative Scenario
                    2) No Trade Scenario

                    ────────────────────────────
                    OUTPUT FORMAT (EXACT STRUCTURE):

                    ## Primary Trade Plan 📊

                    **Symbol:** <symbol>

                    **⏰ Timeframe:** <timeframe>

                    **📈 Market Analysis:**

                    - <Observation 1: session + trend>
                    - <Observation 2: volume behavior>
                    - <Observation 3: key level interaction>

                    **➡️ Primary Direction:** <LONG or SHORT>

                    **🟢 Entry Signal:**  <Precise entry condition>

                    **🔴 Stop Loss:**  <Exact stop level (≤ 20 points from entry) and brief justification>

                    **🟡 Take Profit:**  <Target level and brief justification>

                    **📑 Trade Thesis:**  <Concise explanation combining session, structure, volume, and level>

                    ---

                    ## Alternative Scenario

                    **📉 Contingency Plan:**  
                    If the primary trade thesis is invalidated.

                    **➡️ Alternative Direction:** <LONG or SHORT>

                    **🟢 Contingency Entry:**  <Precise condition for alternative trade>

                    **🔴 Stop Loss:**  <Alternative stop level>

                    **🟡 Take Profit:**  <Alternative target>

                    **📑 Reasoning:**  <Brief technical explanation>

                    ────────────────────────────
                    NO TRADE RULE:

                    If no valid setup exists OR the stop loss would exceed 20 points, return ONLY:

                    ## ⏸️ No Trade

                    **📑 Reason:**  
                    <Brief explanation>
                    `},
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Analyze this trade: Symbol: ${tradeDetails.symbol}, Direction: ${tradeDetails.direction}, PnL: ${tradeDetails.netPnl}.`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageBase64}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        };

        return this.http.post<any>(this.apiUrl, body, { headers }).pipe(
            map(res => res.choices[0]?.message?.content || 'No analysis provided.'),
            catchError(err => {
                console.error('OpenAI Vision Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to contact OpenAI Vision.'));
            })
        );
    }

    predictMarket(candles: any[], symbol: string, timeframe: string): Observable<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) return throwError(() => new Error('OpenAI API Key is missing.'));

        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        });

        const candleStr = candles.map(c =>
            `${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volume}`
        ).join('\n');

        const body = {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are a professional price action analyst and market forecaster. Analyze market data and provide actionable predictions with clear reasoning.'
                },
                {
                    role: 'user',
                    content: `Symbol: ${symbol}\nTimeframe: ${timeframe}\nBars Analyzed: ${candles.length}\n\nRecent Market Data:\n${candleStr}\n\nBased on this ${timeframe} chart data, please provide:\n\n1. **Current Market Structure**: Identify the trend (bullish/bearish/ranging) and key price levels\n2. **Support & Resistance**: Identify immediate support and resistance zones\n3. **Market Prediction**: What is the most likely price direction in the next few bars?\n4. **Trade Setup**: If there's a high-probability setup, describe entry, stop loss, and target\n5. **Risk Assessment**: What could invalidate this prediction?\n\nBe specific with price levels and reasoning.`
                }
            ],
            max_tokens: 1200
        };

        return this.http.post<any>(this.apiUrl, body, { headers }).pipe(
            map(res => res.choices[0]?.message?.content || 'No prediction generated.'),
            catchError(err => {
                console.error('OpenAI Market Prediction Error:', err);
                return throwError(() => new Error(err.error?.error?.message || 'Failed to generate market prediction.'));
            })
        );
    }

    private constructPrompt(candles: any[], trade: any): string {
        const candleStr = candles.map(c =>
            `[${new Date(c.timestamp).toISOString().substr(11, 5)}] O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`
        ).join('\n');

        return `
            Analyze this trade:
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
            4. Verdict: Good Trade or Bad Trade (process-wise)?
        `;
    }
}
