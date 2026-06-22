import { Component, Input, ViewChild, inject, signal, DestroyRef, WritableSignal, OnDestroy } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { provideMarkdown, MarkdownComponent } from 'ngx-markdown';
import { Trade } from '../../../../../core/models/trade.model';
import { computeDayStats, buildEquityCurve, DayStats } from '../../../../../core/utils/trade-stats.utils';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { OpenAiService } from '../../../../../core/services/openai.service';
import { EquityCurveChartComponent } from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { SharePnlComponent, SharePnlStats } from '../../../../../shared/components/share-pnl/share-pnl.component';

type AnalysisState = { status: 'idle' | 'streaming' | 'complete' | 'error'; content: string; error: string | null };
type ConfidenceTier = 'high' | 'medium' | 'low' | null;

const INSIGHT_STEPS = [
    'Reading today\'s trade data',
    'Analyzing performance patterns',
    'Evaluating win/loss dynamics',
    'Assessing risk management',
    'Forming insight',
] as const;

@Component({
    selector: 'app-day-summary',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule, EquityCurveChartComponent, SharePnlComponent, MarkdownComponent],
    providers: [provideMarkdown()],
    templateUrl: './day-summary.component.html',
    styleUrl: './day-summary.component.scss'
})
export class DaySummaryComponent implements OnDestroy {
    @Input({ required: true }) trades!: Trade[];
    @Input() startBalance?: number;
    @Input() date?: string;

    @ViewChild(SharePnlComponent) sharePnl!: SharePnlComponent;

    readonly accountSettings = inject(AccountSettingsService);
    readonly openAiService   = inject(OpenAiService);
    private readonly destroyRef = inject(DestroyRef);

    // ── AI Insight State ─────────────────────────────────────────────────────
    insightState              = signal<AnalysisState>({ status: 'idle', content: '', error: null });
    insightConfidence         = signal<ConfidenceTier>(null);
    followUpInsight           = signal<AnalysisState>({ status: 'idle', content: '', error: null });
    followUpInsightConfidence = signal<ConfidenceTier>(null);
    activeInsightSteps        = signal<string[]>([]);

    private insightStepsInterval: ReturnType<typeof setInterval> | null = null;
    private insightMessages: any[] = [];
    private activeInsight?: Subscription;
    private activeFollowUp?: Subscription;

    get stats(): DayStats {
        return computeDayStats(this.trades);
    }

    get equityData() {
        const base = this.startBalance ?? this.accountSettings.startingBalance();
        return buildEquityCurve(this.trades, base);
    }

    get sharePnlStats(): SharePnlStats {
        const s = this.stats;
        return { winRate: s.winRate, totalTrades: s.totalTrades, winners: s.winners, losers: s.losers };
    }

    openShare(): void {
        this.sharePnl.open();
    }

    // ── AI Insight ───────────────────────────────────────────────────────────
    generateInsight(): void {
        const s = this.stats;
        this.insightMessages = [
            {
                role: 'system',
                content: 'You are an expert trading performance analyst. Analyze a trader\'s daily performance and provide a concise, insightful one-paragraph interpretation. Focus on performance quality, patterns, and one actionable insight. Be direct and specific.'
            },
            {
                role: 'user',
                content: `Date: ${this.date ?? 'today'}
Total trades: ${s.totalTrades}
Net P&L: $${s.netPnl.toFixed(2)}
Win rate: ${s.winRate.toFixed(1)}%
Winners: ${s.winners} / Losers: ${s.losers}
Gross P&L: $${s.grossPnl.toFixed(2)}
Commissions: $${s.commissions.toFixed(2)}
Avg trade: $${s.avgNetPnl.toFixed(2)}

Provide a one-paragraph interpretation.`
            }
        ];
        this.followUpInsight.set({ status: 'idle', content: '', error: null });
        this.followUpInsightConfidence.set(null);
        this.startInsightStream(this.insightMessages, this.insightState, this.insightConfidence);
    }

    tellMeMore(): void {
        if (this.insightState().status !== 'complete') return;
        const s = this.stats;
        const biggestLoss = this.trades.length
            ? Math.min(...this.trades.map(t => t.netPnl || 0))
            : 0;
        const messages = [
            ...this.insightMessages,
            { role: 'assistant', content: this.insightState().content },
            { role: 'user', content: `Elaborate further. Consider: ${s.totalTrades} total trades, ${s.winRate.toFixed(1)}% win rate, biggest single loss of $${biggestLoss.toFixed(2)}. What does this suggest about today's decision quality and risk management?` }
        ];
        this.startInsightStream(messages, this.followUpInsight, this.followUpInsightConfidence);
    }

    // ── Private helpers ──────────────────────────────────────────────────────
    private startInsightStream(
        messages: any[],
        stateSignal: WritableSignal<AnalysisState>,
        confidenceSignal: WritableSignal<ConfidenceTier>
    ): void {
        const isMain = stateSignal === this.insightState;
        if (isMain) {
            this.activeInsight?.unsubscribe();
            this.startInsightStepsAnimation();
        } else {
            this.activeFollowUp?.unsubscribe();
        }

        stateSignal.set({ status: 'streaming', content: '', error: null });

        const sub = this.openAiService.streamAnalysis(messages, 400)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next:     token => stateSignal.update(s => ({ ...s, content: s.content + token })),
                complete: ()    => {
                    if (isMain) this.clearInsightStepsAnimation();
                    stateSignal.update(s => ({ ...s, status: 'complete' }));
                    confidenceSignal.set(this.deriveConfidence(stateSignal().content));
                },
                error:    err   => {
                    if (isMain) this.clearInsightStepsAnimation();
                    stateSignal.update(s => ({ ...s, status: 'error', error: err.message || 'Stream failed.' }));
                },
            });

        if (isMain) this.activeInsight = sub;
        else        this.activeFollowUp = sub;
    }

    ngOnDestroy(): void {
        this.clearInsightStepsAnimation();
    }

    private startInsightStepsAnimation(): void {
        this.clearInsightStepsAnimation();
        this.activeInsightSteps.set([INSIGHT_STEPS[0]]);
        let idx = 1;
        this.insightStepsInterval = setInterval(() => {
            if (idx < INSIGHT_STEPS.length) {
                this.activeInsightSteps.update(steps => [...steps, INSIGHT_STEPS[idx]]);
                idx++;
            }
        }, 1200);
    }

    private clearInsightStepsAnimation(): void {
        if (this.insightStepsInterval !== null) {
            clearInterval(this.insightStepsInterval);
            this.insightStepsInterval = null;
        }
    }

    private deriveConfidence(content: string): ConfidenceTier {
        const t = content.toLowerCase();
        const low    = ['unclear', 'insufficient data', 'no trade', 'cannot determine', 'limited visibility', 'no clear'];
        const high   = ['strong', 'clear', 'confirmed', 'high probability', 'definitive', 'high confidence'];
        const medium = ['likely', 'suggest', 'possible', 'may ', 'could', 'perhaps', 'might'];
        if (low.some(s => t.includes(s)))                                               return 'low';
        if (high.some(s => t.includes(s)) && !medium.some(s => t.includes(s)))         return 'high';
        return 'medium';
    }
}
