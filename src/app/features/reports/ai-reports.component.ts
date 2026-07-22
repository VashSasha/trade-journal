import { Component, inject, signal, DestroyRef, WritableSignal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarkdownComponent } from 'ngx-markdown';
import { TradovateService } from '../../core/services/tradovate.service';
import { AI_GENERIC_ERROR, AI_STREAM_TIMEOUT_MS, OpenAiService } from '../../core/services/openai.service';
import { ReportAnalysisService } from './report-analysis.service';
import { SavedReportsComponent } from './saved-reports/saved-reports.component';
import { VerdictCardComponent } from './verdict-card/verdict-card.component';
import { VerdictCard } from './verdict-card.model';

type AnalysisState = { status: 'idle' | 'streaming' | 'complete' | 'error'; content: string; error: string | null };
type ConfidenceTier = 'high' | 'medium' | 'low' | null;

const ANALYSIS_STEPS = [
    'Reading chart structure',
    'Identifying key price levels',
    'Checking volume patterns',
    'Mapping support and resistance',
    'Applying confluence analysis',
    'Assessing risk-to-reward',
    'Forming trade thesis',
    'Finalizing verdict',
] as const;

@Component({
    selector: 'app-ai-reports',
    standalone: true,
    imports: [FormsModule, MarkdownComponent, RouterLink, SavedReportsComponent, VerdictCardComponent],
    templateUrl: './ai-reports.component.html',
    styleUrl: './ai-reports.component.scss'
})
export class AiReportsComponent implements OnDestroy {
    readonly tradovateService  = inject(TradovateService);
    readonly openAiService     = inject(OpenAiService);
    readonly reportService     = inject(ReportAnalysisService);
    private readonly destroyRef = inject(DestroyRef);

    // ── Preserved inputs (survive regeneration) ──────────────────────────────
    analysisMode  = signal<'screenshot' | 'live'>('screenshot');
    selectedImage = signal<File | null>(null);
    imagePreview  = signal<string | null>(null);
    isDragging    = signal(false);
    symbol        = signal('');
    timeframe     = signal('15min');
    lookbackBars  = signal(100);

    // ── Streaming state ──────────────────────────────────────────────────────
    analysisState      = signal<AnalysisState>({ status: 'idle', content: '', error: null });
    confidence         = signal<ConfidenceTier>(null);
    followUpState      = signal<AnalysisState>({ status: 'idle', content: '', error: null });
    followUpConfidence = signal<ConfidenceTier>(null);
    verdict            = signal<VerdictCard | null>(null);
    activeSteps        = signal<string[]>([]);

    private stepsInterval: ReturnType<typeof setInterval> | null = null;

    private lastMessages: any[] = [];
    private lastFollowUpMessage = '';
    private activeStream?: Subscription;
    private activeFollowUp?: Subscription;
    private mainTimeout: ReturnType<typeof setTimeout> | null = null;
    private followUpTimeout: ReturnType<typeof setTimeout> | null = null;
    private lastAutoSavedKey: string | null = null;

    // ── Image handling ───────────────────────────────────────────────────────
    onImageSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.setImage(input.files?.[0] ?? null);
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        this.isDragging.set(true);
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        this.isDragging.set(false);
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        this.isDragging.set(false);
        this.setImage(event.dataTransfer?.files?.[0] ?? null);
    }

    private setImage(file: File | null): void {
        if (!file || !file.type.startsWith('image/')) return;
        this.selectedImage.set(file);
        const reader = new FileReader();
        reader.onload = e => this.imagePreview.set(e.target?.result as string);
        reader.readAsDataURL(file);
    }

    clearImage(): void {
        this.selectedImage.set(null);
        this.imagePreview.set(null);
    }

    // ── Analysis entry points ────────────────────────────────────────────────
    async analyze(): Promise<void> {
        this.confidence.set(null);
        this.followUpState.set({ status: 'idle', content: '', error: null });
        this.followUpConfidence.set(null);
        this.lastAutoSavedKey = null;

        try {
            if (this.analysisMode() === 'screenshot') {
                const image = this.selectedImage();
                if (!image) return;
                const b64 = await this.fileToBase64(image);
                this.lastMessages = this.buildImageMessages(b64, image.type || 'image/png', this.symbol());
            } else {
                const sym = this.symbol();
                if (!sym) return;
                const candles = await this.tradovateService.getMarketData(sym, this.timeframe(), this.lookbackBars());
                this.lastMessages = this.buildMarketMessages(candles, sym, this.timeframe());
            }
        } catch (err: any) {
            this.analysisState.set({ status: 'error', content: '', error: err.message || 'Failed to prepare analysis.' });
            return;
        }

        this.startStream(this.lastMessages, this.analysisState, this.confidence);
    }

    regenerate(): void {
        if (!this.lastMessages.length) return;
        this.verdict.set(null);
        this.confidence.set(null);
        this.followUpState.set({ status: 'idle', content: '', error: null });
        this.followUpConfidence.set(null);
        this.lastAutoSavedKey = null;
        this.startStream(this.lastMessages, this.analysisState, this.confidence);
    }

    askConfidence(): void {
        this.askFollowUp('State your confidence level explicitly (0–100) and list your top two uncertainties. Respond in 2–3 sentences only.');
    }

    askFollowUp(message: string): void {
        if (this.analysisState().status !== 'complete') return;
        this.lastFollowUpMessage = message;
        const context = this.lastMessages.filter(m => m.role !== 'system');
        const messages = [
            {
                role: 'system',
                content: `You are an expert trading analyst continuing a conversation about a chart you already analyzed. Answer the trader's follow-up question directly and conversationally in concise GitHub-flavored Markdown prose — a few sentences or short bullet points. Do NOT output JSON, code fences, or the structured verdict format again.`
            },
            ...context,
            { role: 'assistant', content: JSON.stringify(this.verdict()) },
            { role: 'user', content: message }
        ];
        this.startStream(messages, this.followUpState, this.followUpConfidence);
    }

    retryFollowUp(): void {
        if (this.lastFollowUpMessage) this.askFollowUp(this.lastFollowUpMessage);
    }

    // ── Private helpers ──────────────────────────────────────────────────────
    private startStream(
        messages: any[],
        stateSignal: WritableSignal<AnalysisState>,
        confidenceSignal?: WritableSignal<ConfidenceTier>
    ): void {
        const isMain = stateSignal === this.analysisState;
        if (isMain) {
            this.activeStream?.unsubscribe();
            this.startStepsAnimation();
        } else {
            this.activeFollowUp?.unsubscribe();
        }
        this.clearStreamTimeout(isMain);

        stateSignal.set({ status: 'streaming', content: '', error: null });
        let firstToken = false;
        let autoSaved = false;

        const fail = (message: string) => {
            if (isMain) this.clearStepsAnimation();
            this.clearStreamTimeout(isMain);
            stateSignal.set({ status: 'error', content: '', error: message });
        };

        const timeout = setTimeout(() => {
            if (firstToken) return;
            (isMain ? this.activeStream : this.activeFollowUp)?.unsubscribe();
            fail('This is taking longer than expected. Please try again.');
        }, AI_STREAM_TIMEOUT_MS);
        if (isMain) this.mainTimeout = timeout;
        else        this.followUpTimeout = timeout;

        const sub = this.openAiService.streamAnalysis(messages)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: token => {
                    if (!firstToken) {
                        firstToken = true;
                        this.clearStreamTimeout(isMain);
                    }
                    stateSignal.update(s => ({ ...s, content: s.content + token }));
                },
                complete: () => {
                    if (isMain) this.clearStepsAnimation();
                    this.clearStreamTimeout(isMain);
                    stateSignal.update(s => ({ ...s, status: 'complete' }));
                    if (isMain) {
                        try {
                            const parsed: VerdictCard = JSON.parse(this.extractJson(stateSignal().content));
                            this.verdict.set(parsed);
                            const score = parsed.confidenceScore;
                            confidenceSignal?.set(score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low');
                            // Auto-save the structured verdict; guard prevents double-save per generation.
                            const key = JSON.stringify(parsed);
                            if (!autoSaved && key !== this.lastAutoSavedKey) {
                                autoSaved = true;
                                this.lastAutoSavedKey = key;
                                void this.reportService.saveReport(this.deriveReportTitle(parsed), parsed);
                            }
                        } catch {
                            stateSignal.set({ status: 'error', content: '', error: 'Response was not valid JSON. Try again.' });
                        }
                    } else {
                        confidenceSignal?.set(this.deriveConfidence(stateSignal().content));
                    }
                },
                error: err => fail(err?.message || AI_GENERIC_ERROR),
            });

        if (isMain) this.activeStream = sub;
        else        this.activeFollowUp = sub;
    }

    private clearStreamTimeout(isMain: boolean): void {
        const key = isMain ? 'mainTimeout' : 'followUpTimeout';
        if (this[key] !== null) {
            clearTimeout(this[key]!);
            this[key] = null;
        }
    }

    private extractJson(raw: string): string {
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenced) return fenced[1];
        const start = raw.indexOf('{');
        const end   = raw.lastIndexOf('}');
        return start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
    }

    private deriveConfidence(content: string): ConfidenceTier {
        const t = content.toLowerCase();
        const low    = ['unclear', 'insufficient data', 'no trade', 'cannot determine', 'limited visibility', 'no clear'];
        const high   = ['strong', 'clear', 'confirmed', 'high probability', 'definitive', 'high confidence'];
        const medium = ['likely', 'suggest', 'possible', 'may ', 'could', 'perhaps', 'might'];
        if (low.some(s => t.includes(s)))                                            return 'low';
        if (high.some(s => t.includes(s)) && !medium.some(s => t.includes(s))) return 'high';
        return 'medium';
    }

    private deriveReportTitle(v: VerdictCard): string {
        const sym = (v.symbol || this.symbol()).trim().toUpperCase();
        if (this.analysisMode() === 'live') {
            return sym ? `${sym} · ${this.timeframe()} · Live Data` : `${this.timeframe()} · Live Data`;
        }
        return sym ? `Screenshot · ${sym}` : 'Screenshot analysis';
    }

    private readonly verdictJsonSchema = `{"symbol":"...","timeframe":"...","direction":"Short|Long","conviction":"...","confidenceScore":0,"confluenceCount":0,"primarySignal":"...","levels":{"entry":{"price":"...","note":"..."},"stop":{"price":"...","note":"..."},"target":{"price":"...","note":"..."}},"confluences":["..."],"contingency":{"direction":"Long|Short","trigger":{"price":"...","note":"..."},"stop":{"price":"...","note":"..."},"target":{"price":"...","note":"..."},"condition":"..."},"contextChips":["...","..."]}`;

    private buildImageMessages(b64: string, mediaType: string, symbol: string): any[] {
        return [
            {
                role: 'system',
                content: `You are an expert quantitative analyst and professional technical trader.

You MUST respond with a single valid JSON object only. No markdown, no code fences, no explanation outside the JSON. The JSON must have this exact shape:
${this.verdictJsonSchema}

INTERNAL ANALYSIS (DO NOT OUTPUT):
- Identify the active trading session (Asia, London, New York).
- Determine market structure (trend, HH/HL or LH/LL).
- Identify key support and resistance levels.
- Analyze volume behavior (confirming or weakening).
- Risk management: stop loss MUST be ≤ 20 points from entry.
- If no valid setup exists, set direction to "Short" with confidenceScore 0, primarySignal explaining why, and placeholder level values.
- contextChips: 2 relevant follow-up questions the trader might want to ask.`
            },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64}` } },
                    { type: 'text', text: `Analyze this chart${symbol ? ` for ${symbol}` : ''}.` }
                ]
            }
        ];
    }

    private buildMarketMessages(candles: any[], symbol: string, timeframe: string): any[] {
        const candleStr = candles.map(c =>
            `${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volume}`
        ).join('\n');
        return [
            {
                role: 'system',
                content: `You are a professional price action analyst and market forecaster.

You MUST respond with a single valid JSON object only. No markdown, no code fences, no explanation outside the JSON. The JSON must have this exact shape:
${this.verdictJsonSchema}

Derive all fields from the market data. Set contextChips to 2 relevant follow-up questions.`
            },
            {
                role: 'user',
                content: `Symbol: ${symbol}\nTimeframe: ${timeframe}\nBars: ${candles.length}\n\nRecent Market Data:\n${candleStr}`
            }
        ];
    }

    ngOnDestroy(): void {
        this.clearStepsAnimation();
        this.clearStreamTimeout(true);
        this.clearStreamTimeout(false);
    }

    private startStepsAnimation(): void {
        this.clearStepsAnimation();
        this.activeSteps.set([ANALYSIS_STEPS[0]]);
        let idx = 1;
        this.stepsInterval = setInterval(() => {
            if (idx < ANALYSIS_STEPS.length) {
                this.activeSteps.update(steps => [...steps, ANALYSIS_STEPS[idx]]);
                idx++;
            }
        }, 1200);
    }

    private clearStepsAnimation(): void {
        if (this.stepsInterval !== null) {
            clearInterval(this.stepsInterval);
            this.stepsInterval = null;
        }
    }

    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}
