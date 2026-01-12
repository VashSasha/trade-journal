import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
export class OpenAiService {
    private apiUrl = 'https://api.openai.com/v1/chat/completions';

    constructor(private http: HttpClient) { }

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
            model: 'gpt-4o', // or gpt-4-turbo
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
                    content: `You are an expert quantitative analyst and professional technical trader. Your mission is to analyze OCR data extracted from a trading chart screenshot and formulate a complete, actionable trading plan. The data may be imperfect or fragmented, so you must infer context and act as a high-level trading assistant. Your Internal Analysis Process (Mandatory Steps): Time & Session Context: First, determine the time of day and identify which major trading session (e.g., Asia, London, New York) is active or overlapping. Analyze the current trend's validity within this specific session. Is the momentum recent and session-driven? Core Technical Analysis:
Market Structure: Identify the dominant short-term trend (e.g., higher highs and higher lows for an uptrend).
Key Levels: Pinpoint the most critical support and resistance zones based on the visible chart data.
Volume Profile: Analyze the volume. Is it increasing with the trend, suggesting conviction, or is it declining, suggesting the move is weak?
Confluence: Synthesize these points to form a primary trade thesis. A high-probability setup requires multiple factors (e.g., trend, key level, and volume) pointing in the same direction.
Risk Management: Your primary trade plan MUST incorporate a stop loss that does not exceed 20 points from the entry signal. If the logical technical stop is further than 20 points away, you must adjust the entry or pass on the trade.
Final Output Instructions:
After your internal analysis, you MUST present the final trading plan in the following exact structure. Your primary and most probable trade idea must be presented first. Do not add any text or explanations outside of this format.
[Primary Trade Plan]
📊 Symbol: [Identify the symbol, e.g., NQ Futures, EUR/USD]
⏰ Timeframe: [Identify the chart timeframe, e.g., 5 Minute]
📈 Market Analysis:
[Provide 2-3 bullet points on key observations. Mention the active session, trend, and volume. e.g., "Price is in a clear uptrend during the New York session, holding above the 20 EMA."]
[e.g., "Bullish volume is confirming the upward move, indicating strong buying interest."]
[e.g., "Price has just broken and is retesting a key resistance level at 18100."]
➡️ Primary Direction: [LONG/SHORT]
🟢 Entry Signal:
[Describe the precise condition for entry. e.g., "Enter long on a successful bullish bounce off the 18100 support level."]
🔴 Stop Loss:
[State the exact level (Max 20 points from entry) and a brief reason. e.g., "18080, placed 20 points below entry to protect against a failed retest."]
🟡 Take Profit:
[State the target level and a brief reason. e.g., "18190, targeting the next major resistance area with a favorable risk/reward ratio."]
📑 Trade Thesis:
[Provide a concise summary explaining why this is a high-probability trade. Combine the analysis. e.g., "This is a high-probability trend continuation trade. The long entry is supported by the clear NY session uptrend, confirming volume, and a successful retest of a key breakout level, indicating strong momentum."]
[Alternative Scenario]
📉 Contingency Plan: If the primary thesis is invalidated.
➡️ Alternative Direction: [LONG/SHORT]
🟢 Contingency Entry:
[Describe the precise condition for the alternative trade. e.g., "If the price breaks down decisively below 18070."]
🔴 Stop Loss:
[State the stop for the alternative trade. e.g., "18090, placed above the breakdown level."]
🟡 Take Profit:
[State the target for the alternative trade. e.g., "18000, targeting the next significant support."]
📑 Reasoning:
[Briefly explain the logic. e.g., "A break below 18070 would invalidate the bullish structure and likely trigger a sell-off towards the next support."]
"No Trade" Scenario:
If your analysis does not yield a clear, high-probability setup with a valid risk parameter (<= 20 points), you MUST return ONLY the following structure:
⏸️ No Trade
📑 Reason: [Provide a brief explanation, e.g., "Price is in a choppy, sideways range during a low-volume period. The technical stop loss would exceed the 20-point maximum, offering poor risk management."]`
                },
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
        // Format candles for token efficiency
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
