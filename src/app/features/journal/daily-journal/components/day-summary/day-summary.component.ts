import { Component, computed, DestroyRef, inject, Input, OnDestroy, signal, ViewChild, WritableSignal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarkdownComponent } from 'ngx-markdown';
import { Trade } from '../../../../../core/models/trade.model';
import { buildEquityCurve, computeDayStats, DayStats } from '../../../../../core/utils/trade-stats.utils';
import { tradeSessionDateStr } from '../../../../../core/utils/market-holidays';
import { AccountSettingsService } from '../../../../../core/services/account-settings.service';
import { DailyJournalService } from '../../../../../core/services/daily-journal.service';
import { FilterService } from '../../../../../core/services/filter.service';
import { TradeService } from '../../../../../core/services/trade.service';
import { AI_GENERIC_ERROR, AI_STREAM_TIMEOUT_MS, OpenAiService } from '../../../../../core/services/openai.service';
import {
  EquityCurveChartComponent
} from '../../../../../shared/components/equity-curve-chart/equity-curve-chart.component';
import { SharePnlComponent, SharePnlStats } from '../../../../../shared/components/share-pnl/share-pnl.component';
import { AiAnalysisService } from '../saved-analyses/ai-analysis.service';
import { JournalFormState } from '../../state/journal-form.state';

type AnalysisState = { status: 'idle' | 'streaming' | 'complete' | 'error'; content: string; error: string | null };
type ConfidenceTier = 'high' | 'medium' | 'low' | null;

/** Parsed coach reply — null when the markdown doesn't match the contract. */
interface CoachCard {
  grade: string | null;   // "B+", "A", …
  verdict: string;        // full verdict line (markdown, includes the bold grade)
  worked: string;         // "What worked" bullets (markdown)
  cost: string;           // "What cost you" bullets (markdown)
}

const INSIGHT_STEPS = [
  'Reviewing your trades',
  'Reading your journal and plan',
  'Comparing to your 30-day baseline',
  'Checking yesterday\'s commitment',
  'Grading the day',
] as const;

const TASK_LINE = /^[-*]\s*\[[ xX]?\]\s+/;

@Component({
  selector: 'app-day-summary',
  standalone: true,
  imports: [CurrencyPipe, DecimalPipe, FormsModule, EquityCurveChartComponent, SharePnlComponent, MarkdownComponent],
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
  private readonly aiAnalysis = inject(AiAnalysisService);
  private readonly journalService = inject(DailyJournalService);
  private readonly tradeService = inject(TradeService);
  private readonly filterService = inject(FilterService);
  /** Live journal form (present inside the journal shell; null elsewhere). */
  private readonly journalForm = inject(JournalFormState, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  // ── AI Insight State ─────────────────────────────────────────────────────
  insightState = signal<AnalysisState>({status: 'idle', content: '', error: null});
  insightConfidence = signal<ConfidenceTier>(null);
  followUpInsight = signal<AnalysisState>({status: 'idle', content: '', error: null});
  followUpInsightConfidence = signal<ConfidenceTier>(null);
  activeInsightSteps = signal<string[]>([]);
  copiedFocus = signal(false);

  // ── Save-analysis state ──────────────────────────────────────────────────
  aiSaving = signal(false);
  aiSaveError = signal<string | null>(null);
  /** Content of the last successfully saved insight — guards against double-saves. */
  private savedContent = signal<string | null>(null);

  /** True once the current insight text has been persisted (soften/disable Save). */
  readonly insightSaved = computed(() => {
    const saved = this.savedContent();
    return saved !== null && saved === this.insightState().content;
  });

  /** Structured coach card, parsed from the completed reply (null → raw fallback). */
  readonly coach = computed((): CoachCard | null => {
    const state = this.insightState();
    if (state.status !== 'complete') return null;
    return this.parseCoach(state.content);
  });

  /** The single "Tomorrow's focus" task line (raw markdown, `- [ ] …`). */
  readonly focusItem = computed(() => {
    const content = this.insightState().content;
    return content ? this.extractFocusLine(content) : null;
  });

  /** Focus text without the task-list marker — for the pinned hero row. */
  readonly focusText = computed(() => {
    const item = this.focusItem();
    return item ? item.replace(TASK_LINE, '') : null;
  });

  private insightStepsInterval: ReturnType<typeof setInterval> | null = null;
  private insightMessages: any[] = [];
  private activeInsight?: Subscription;
  private activeFollowUp?: Subscription;
  private insightTimeout: ReturnType<typeof setTimeout> | null = null;
  private followUpTimeout: ReturnType<typeof setTimeout> | null = null;

  get stats(): DayStats {
    return computeDayStats(this.trades);
  }

  /**
   * Starting point shared by the curve AND the chart's dashed baseline. They
   * must be the same value — a baseline decoupled from the curve start (e.g.
   * the raw account-size setting vs a ~$0 balance) paints the whole chart as
   * one giant red fill on a flat day.
   */
  get chartBase(): number {
    return this.startBalance ?? this.accountSettings.startingBalance();
  }

  get equityData() {
    return buildEquityCurve(this.trades, this.chartBase);
  }

  get sharePnlStats(): SharePnlStats {
    const s = this.stats;
    return {winRate: s.winRate, totalTrades: s.totalTrades, winners: s.winners, losers: s.losers};
  }

  openShare(): void {
    this.sharePnl.open();
  }

  /** A/B → good, C → mid, D/F → bad — drives the grade chip color. */
  gradeTone(grade: string): 'good' | 'mid' | 'bad' {
    const letter = grade.charAt(0);
    if (letter === 'A' || letter === 'B') return 'good';
    if (letter === 'C') return 'mid';
    return 'bad';
  }

  /** Copy tomorrow's focus (raw task-list line) to the clipboard. */
  copyFocus(): void {
    const item = this.focusItem();
    if (!item) return;
    navigator.clipboard.writeText(item).then(() => {
      this.copiedFocus.set(true);
      setTimeout(() => this.copiedFocus.set(false), 2000);
    });
  }

  // ── AI Insight ───────────────────────────────────────────────────────────
  async generateInsight(): Promise<void> {
    const yesterdayFocus = await this.fetchYesterdayFocus();

    this.insightMessages = [
      {
        role: 'system',
        content: `You are the trader's personal trading coach — direct, specific, and on their side. You know their plan, rules, and recent history from the data provided. Reply in GitHub-flavored Markdown using EXACTLY these four sections in this order, nothing else:

## Verdict
One line only: a letter grade A–F for PROCESS QUALITY (not P&L — a disciplined red day can outgrade a sloppy green one), bold, then an em dash and one blunt sentence. Format: "**B+** — You traded your plan until the last hour."

## What worked
1–2 one-line bullets, each tied to a specific trade or behavior from today.

## What cost you
1–2 one-line bullets naming the specific trade, time, or behavior. If a "Yesterday you committed to" line is provided, exactly one bullet MUST say whether they kept that commitment.

## Tomorrow's focus
EXACTLY ONE task-list item (\`- [ ]\`) — the single highest-leverage change, concrete and checkable, e.g. "- [ ] Stop trading after 2 consecutive losses".

Rules: address the trader as "you". Never invent trades, prices, or data you were not given. Reference their plan, rules, mood, or baseline when relevant. Keep the whole reply under 150 words. No preamble, no closing remarks.`
      },
      {
        role: 'user',
        content: this.buildCoachInput(yesterdayFocus)
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
        content: `Go deeper on today's review. Expand on your verdict and the "What cost you" items — walk through the specific trades and times behind them. Given ${s.totalTrades} trades, a ${s.winRate.toFixed(1)}% win rate, and a biggest single loss of $${biggestLoss.toFixed(2)}: what does today say about my decision quality and risk management? Reply in short Markdown prose — no new grade, no new sections.`
      }
    ];
    this.startInsightStream(messages, this.followUpInsight, this.followUpInsightConfidence);
  }

  // ── Coach input builders ─────────────────────────────────────────────────

  /** Assemble the full user message: day stats, trade tape, journal, baseline, continuity. */
  private buildCoachInput(yesterdayFocus: string | null): string {
    const s = this.stats;
    const parts = [
      `Coach me on this trading day.`,
      `Date: ${this.date ?? 'today'}
Day stats: ${s.totalTrades} trades · Net P&L: ${this.fmtMoney(s.netPnl)} · Win rate: ${s.winRate.toFixed(1)}% (${s.winners}W/${s.losers}L) · Gross: ${this.fmtMoney(s.grossPnl)} · Commissions: ${this.fmtMoney(s.commissions)} · Avg trade: ${this.fmtMoney(s.avgNetPnl)}`,
      `Trades (chronological):\n${this.tradeLines()}`,
      this.journalContext(),
      this.baselineContext(),
      yesterdayFocus ? `Yesterday you committed to: "${yesterdayFocus}"` : ''
    ];
    return parts.filter(Boolean).join('\n\n');
  }

  /** One line per trade, in execution order, so sequences are visible. */
  private tradeLines(): string {
    const sorted = [...this.trades].sort((a, b) => (a.entryDate ?? '').localeCompare(b.entryDate ?? ''));
    return sorted.map(t => {
      const pnl = t.netPnl ?? t.pnl ?? 0;
      const hold = this.holdDuration(t);
      const dir = t.direction === 'short' ? 'SHORT' : 'LONG';
      return `${this.fmtTime(t)} ${t.symbol} ${dir} x${t.quantity} → ${this.fmtMoney(pnl)}${hold ? ` (held ${hold})` : ''}`;
    }).join('\n');
  }

  /** Plan, mood/discipline, rules followed vs broken, tags — live form when present, saved note otherwise. */
  private journalContext(): string {
    const note = this.date ? this.journalService.getNoteForDate(this.date) : undefined;
    const form = this.journalForm;

    const planRaw = form ? form.preMarketPlan() : note?.preMarketPlan ?? '';
    const plan = this.stripHtml(planRaw).trim().slice(0, 500);
    const mood = form ? form.mood() : note?.mood ?? 0;
    const discipline = form ? form.discipline() : note?.discipline ?? 0;
    const followed = form ? [...form.checkedRules()] : note?.rulesFollowed ?? [];
    const broken = this.journalService.customRules().filter(r => !followed.includes(r));
    const tags = form ? form.tags() : note?.tags ?? [];

    const lines = [
      `Pre-market plan: ${plan ? `"${plan}"` : 'none recorded'}`,
      `Mood: ${mood ? `${mood}/5` : 'not recorded'} · Discipline: ${discipline ? `${discipline}/5` : 'not recorded'}`,
      followed.length ? `Rules followed: ${followed.join('; ')}` : '',
      broken.length ? `Rules NOT checked off: ${broken.join('; ')}` : '',
      tags.length ? `Tags: ${tags.join(', ')}` : ''
    ].filter(Boolean);

    return `Journal:\n${lines.join('\n')}`;
  }

  /** 30-day win rate + avg daily P&L, and the green/red day streak coming into today. */
  private baselineContext(): string {
    const date = this.date;
    if (!date) return '';

    const all = this.filterService.filterTradesIgnoreDateRange(this.tradeService.trades());
    const windowStart = this.shiftDate(date, -30);
    const dayPnls = new Map<string, number>();
    let wins = 0, total = 0;

    for (const t of all) {
      const key = tradeSessionDateStr((t.status === 'closed' && t.exitDate) ? t.exitDate : t.entryDate);
      if (!key || key >= date) continue; // only days BEFORE today
      const pnl = t.netPnl ?? t.pnl ?? 0;
      dayPnls.set(key, (dayPnls.get(key) ?? 0) + pnl);
      if (key >= windowStart) {
        total++;
        if (pnl > 0) wins++;
      }
    }
    if (total === 0) return '';

    const windowDays = [...dayPnls.entries()].filter(([d]) => d >= windowStart);
    const avgDaily = windowDays.length
      ? windowDays.reduce((sum, [, pnl]) => sum + pnl, 0) / windowDays.length
      : 0;

    // Consecutive same-sign trading days ending just before today.
    let streak = 0, sign = 0;
    for (const day of [...dayPnls.keys()].sort().reverse()) {
      const daySign = dayPnls.get(day)! > 0 ? 1 : dayPnls.get(day)! < 0 ? -1 : 0;
      if (streak === 0) {
        if (daySign === 0) break;
        sign = daySign;
        streak = 1;
      } else if (daySign === sign) {
        streak++;
      } else {
        break;
      }
    }

    const parts = [
      `Win rate: ${((wins / total) * 100).toFixed(1)}% over ${total} trades`,
      `Avg daily P&L: ${this.fmtMoney(avgDaily)}`
    ];
    if (streak > 0) {
      parts.push(`Coming into today: ${streak} ${sign > 0 ? 'green' : 'red'} day${streak > 1 ? 's' : ''} in a row`);
    }
    return `30-day baseline (before today):\n${parts.join(' · ')}`;
  }

  /** "Tomorrow's focus" from the most recent saved analysis before this date. */
  private async fetchYesterdayFocus(): Promise<string | null> {
    if (!this.date) return null;
    try {
      const prev = await this.aiAnalysis.latestAnalysisBefore(this.date);
      if (!prev) return null;
      const line = this.extractFocusLine(prev.content);
      return line ? line.replace(TASK_LINE, '') : null;
    } catch {
      return null;
    }
  }

  // ── Coach reply parsing ──────────────────────────────────────────────────

  /** Split the reply into the four contract sections; null if it doesn't conform. */
  private parseCoach(content: string): CoachCard | null {
    const sections = new Map<string, string>();
    for (const part of content.split(/^##\s+/m)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const nl = trimmed.indexOf('\n');
      const heading = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim().toLowerCase();
      sections.set(heading, nl === -1 ? '' : trimmed.slice(nl + 1).trim());
    }
    const find = (match: (h: string) => boolean) =>
      [...sections.entries()].find(([h]) => match(h))?.[1] ?? '';

    const verdict = find(h => h.startsWith('verdict'));
    if (!verdict) return null;

    return {
      grade: verdict.match(/\*\*([A-F][+-]?)\*\*/)?.[1] ?? null,
      verdict,
      worked: find(h => h.includes('worked')),
      cost: find(h => h.includes('cost'))
    };
  }

  /**
   * The single task-list line from the "Tomorrow's focus" section (older saved
   * analyses used "Action Points" — accept that too). Falls back to the first
   * task item anywhere so a slightly-off reply still works.
   */
  private extractFocusLine(content: string): string | null {
    const lines = content.split('\n').map(l => l.trim());
    let inFocus = false;
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        inFocus = /focus|action\s*point/i.test(line);
        continue;
      }
      if (inFocus && TASK_LINE.test(line)) return line;
    }
    return lines.find(l => TASK_LINE.test(l)) ?? null;
  }

  // ── Formatting helpers ───────────────────────────────────────────────────

  private fmtMoney(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}$${Math.abs(value).toFixed(2)}`;
  }

  private fmtTime(t: Trade): string {
    const d = new Date(t.entryDate);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }
    return t.entryTime ?? '--:--';
  }

  private holdDuration(t: Trade): string | null {
    if (!t.exitDate) return null;
    const entry = new Date(t.entryDate).getTime();
    const exit = new Date(t.exitDate).getTime();
    if (isNaN(entry) || isNaN(exit) || exit <= entry) return null;
    const mins = Math.round((exit - entry) / 60_000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent ?? '';
  }

  private shiftDate(date: string, days: number): string {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────
  /** Persist the current insight markdown for the active journal date. */
  async saveInsight(): Promise<void> {
    const content = this.insightState().content;
    const date = this.date;
    if (this.insightState().status !== 'complete' || !content || !date) return;
    if (this.aiSaving() || this.insightSaved()) return;

    this.aiSaving.set(true);
    this.aiSaveError.set(null);
    try {
      await this.aiAnalysis.saveAnalysis(date, content);
      this.savedContent.set(content);
    } catch (err: any) {
      this.aiSaveError.set(err?.message || 'Couldn\'t save analysis. Please try again.');
    } finally {
      this.aiSaving.set(false);
    }
  }

  private startInsightStream(
    messages: any[],
    stateSignal: WritableSignal<AnalysisState>,
    confidenceSignal: WritableSignal<ConfidenceTier>
  ): void {
    const isMain = stateSignal === this.insightState;
    if (isMain) {
      this.activeInsight?.unsubscribe();
      this.startInsightStepsAnimation();
      // A fresh insight is a fresh thing to save — clear any prior save state.
      this.aiSaveError.set(null);
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

    const sub = this.openAiService.streamAnalysis(messages, 700)
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
