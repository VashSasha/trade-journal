import { Component, computed, DestroyRef, inject, Input, OnDestroy, signal, ViewChild, WritableSignal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarkdownComponent, provideMarkdown } from 'ngx-markdown';
import { Trade } from '../../../../../core/models/trade.model';
import { buildEquityCurve, computeDayStats, DayStats } from '../../../../../core/utils/trade-stats.utils';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { AI_GENERIC_ERROR, AI_STREAM_TIMEOUT_MS, OpenAiService } from '../../../../../core/services/openai.service';
import {
  EquityCurveChartComponent
} from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';
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
  imports: [CurrencyPipe, DecimalPipe, FormsModule, EquityCurveChartComponent, SharePnlComponent, MarkdownComponent, RouterLink],
  providers: [provideMarkdown()],
  templateUrl: './day-summary.component.html',
  styleUrl: './day-summary.component.scss'
})
export class DaySummaryComponent implements OnDestroy {
  @Input({required: true}) trades!: Trade[];
  @Input() startBalance?: number;
  @Input() date?: string;

  @ViewChild(SharePnlComponent) sharePnl!: SharePnlComponent;

  readonly accountSettings = inject(AccountSettingsService);
  readonly openAiService = inject(OpenAiService);
  private readonly destroyRef = inject(DestroyRef);

  // ── AI Insight State ─────────────────────────────────────────────────────
  insightState = signal<AnalysisState>({status: 'idle', content: '', error: null});
  insightConfidence = signal<ConfidenceTier>(null);
  followUpInsight = signal<AnalysisState>({status: 'idle', content: '', error: null});
  followUpInsightConfidence = signal<ConfidenceTier>(null);
  activeInsightSteps = signal<string[]>([]);
  copiedActionPoints = signal(false);

  /** Task-list items extracted from the AI insight's "Action Points" section. */
  readonly actionPoints = computed(() => this.extractActionPoints(this.insightState().content));

  private insightStepsInterval: ReturnType<typeof setInterval> | null = null;
  private insightMessages: any[] = [];
  private activeInsight?: Subscription;
  private activeFollowUp?: Subscription;
  private insightTimeout: ReturnType<typeof setTimeout> | null = null;
  private followUpTimeout: ReturnType<typeof setTimeout> | null = null;

  get stats(): DayStats {
    return computeDayStats(this.trades);
  }

  get equityData() {
    const base = this.startBalance ?? this.accountSettings.startingBalance();
    return buildEquityCurve(this.trades, base);
  }

  get sharePnlStats(): SharePnlStats {
    const s = this.stats;
    return {winRate: s.winRate, totalTrades: s.totalTrades, winners: s.winners, losers: s.losers};
  }

  openShare(): void {
    this.sharePnl.open();
  }

  /** Copy the AI's action-points checklist (raw Markdown) to the clipboard. */
  copyActionPoints(): void {
    const items = this.actionPoints();
    if (!items.length) return;
    navigator.clipboard.writeText(items.join('\n')).then(() => {
      this.copiedActionPoints.set(true);
      setTimeout(() => this.copiedActionPoints.set(false), 2000);
    });
  }

  /**
   * Pull GitHub task-list items (`- [ ] ...`) out of the "Action Points" section
   * of the insight Markdown. Falls back to any task-list items in the content if
   * the heading isn't matched, so a slightly-off model response still copies.
   */
  private extractActionPoints(content: string): string[] {
    const isTask = (line: string) => /^[-*]\s*\[[ xX]?\]\s+/.test(line);
    const lines = content.split('\n').map(l => l.trim());

    const inSection: string[] = [];
    let active = false;
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        active = /action\s*point/i.test(line);
        continue;
      }
      if (active && isTask(line)) inSection.push(line);
    }
    if (inSection.length) return inSection;

    return lines.filter(isTask);
  }

  // ── AI Insight ───────────────────────────────────────────────────────────
  generateInsight(): void {
    const s = this.stats;
    this.insightMessages = [
      {
        role: 'system',
        content: `You are an expert trading performance analyst. Analyze a trader's daily performance and reply in concise, scannable GitHub-flavored Markdown using EXACTLY these sections and headings:

## Summary
2–3 sentences on the day's performance quality and the single most important pattern.

## Key Takeaways
2–4 short one-line bullet points, drawn strictly from the data.

## Action Points for Tomorrow
A checklist of 3–5 specific, concrete steps the trader can apply tomorrow. Write each as a GitHub task list item that starts with a verb, e.g. \`- [ ] Cut position size after two consecutive losses\`.

Rules: be direct and specific, base every claim on the numbers provided, never invent trades or prices you were not given, and keep the whole reply tight.`
      },
      {
        role: 'user',
        content: `Analyze this trading day.

Date: ${this.date ?? 'today'}
Total trades: ${s.totalTrades}
Net P&L: $${s.netPnl.toFixed(2)}
Win rate: ${s.winRate.toFixed(1)}%
Winners: ${s.winners} / Losers: ${s.losers}
Gross P&L: $${s.grossPnl.toFixed(2)}
Commissions: $${s.commissions.toFixed(2)}
Avg trade: $${s.avgNetPnl.toFixed(2)}`
      }
    ];
    this.followUpInsight.set({status: 'idle', content: '', error: null});
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
      {role: 'assistant', content: this.insightState().content},
      {
        role: 'user',
        content: `Elaborate further. Consider: ${s.totalTrades} total trades, ${s.winRate.toFixed(1)}% win rate, biggest single loss of $${biggestLoss.toFixed(2)}. What does this suggest about today's decision quality and risk management?`
      }
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
    this.clearInsightTimeout(isMain);

    stateSignal.set({status: 'streaming', content: '', error: null});
    let firstToken = false;

    // Fail into the error state (never spin forever) — set on error, timeout,
    // and used to guarantee loading always stops.
    const fail = (message: string) => {
      if (isMain) this.clearInsightStepsAnimation();
      this.clearInsightTimeout(isMain);
      stateSignal.set({status: 'error', content: '', error: message});
    };

    // If the upstream hangs and no first token arrives, abort and surface a
    // timeout error instead of an endless spinner.
    const timeout = setTimeout(() => {
      if (firstToken) return;
      (isMain ? this.activeInsight : this.activeFollowUp)?.unsubscribe();
      fail('This is taking longer than expected. Please try again.');
    }, AI_STREAM_TIMEOUT_MS);
    if (isMain) this.insightTimeout = timeout;
    else this.followUpTimeout = timeout;

    const sub = this.openAiService.streamAnalysis(messages, 600)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: token => {
          if (!firstToken) {
            firstToken = true;
            this.clearInsightTimeout(isMain);
          }
          stateSignal.update(s => ({...s, content: s.content + token}));
        },
        complete: () => {
          if (isMain) this.clearInsightStepsAnimation();
          this.clearInsightTimeout(isMain);
          stateSignal.update(s => ({...s, status: 'complete'}));
          confidenceSignal.set(this.deriveConfidence(stateSignal().content));
        },
        error: err => fail(err?.message || AI_GENERIC_ERROR),
      });

    if (isMain) this.activeInsight = sub;
    else this.activeFollowUp = sub;
  }

  private clearInsightTimeout(isMain: boolean): void {
    const key = isMain ? 'insightTimeout' : 'followUpTimeout';
    if (this[key] !== null) {
      clearTimeout(this[key]!);
      this[key] = null;
    }
  }

  ngOnDestroy(): void {
    this.clearInsightStepsAnimation();
    this.clearInsightTimeout(true);
    this.clearInsightTimeout(false);
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
    const low = ['unclear', 'insufficient data', 'no trade', 'cannot determine', 'limited visibility', 'no clear'];
    const high = ['strong', 'clear', 'confirmed', 'high probability', 'definitive', 'high confidence'];
    const medium = ['likely', 'suggest', 'possible', 'may ', 'could', 'perhaps', 'might'];
    if (low.some(s => t.includes(s))) return 'low';
    if (high.some(s => t.includes(s)) && !medium.some(s => t.includes(s))) return 'high';
    return 'medium';
  }
}
