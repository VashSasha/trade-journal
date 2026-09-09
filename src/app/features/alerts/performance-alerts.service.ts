import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { cacheSuspended } from '../../core/services/user-data/user-data.cache';
import { TradovateLiveAccountMetric } from '../integrations/tradovate-live/tradovate-live.models';
import { TradovateLiveService } from '../integrations/tradovate-live/tradovate-live.service';
import { SessionAlertsService } from './session-alerts.service';
import { AlertCenterService } from './alert-center.service';
import { AccountAlertPreferencesService } from './account-alert-preferences.service';
import {
    crossedPerformanceAlerts, performanceMetrics, PerformanceAlertRule, PerformanceMetrics, weekStartFor,
} from './performance-alerts.utils';

export interface PerformanceAlertEvent {
    id: number;
    tone: 'target' | 'risk';
    text: string;
}

/** Evaluates guardrails when the owner-scoped trade signal receives fresh data. */
@Injectable({ providedIn: 'root' })
export class PerformanceAlertsService {
    private readonly trades = inject(TradeService);
    private readonly filters = inject(FilterService);
    private readonly userData = inject(UserDataService);
    private readonly session = inject(UserSessionService);
    private readonly sounds = inject(SessionAlertsService);
    private readonly alertCenter = inject(AlertCenterService);
    private readonly accountPreferences = inject(AccountAlertPreferencesService);
    readonly live = inject(TradovateLiveService);

    readonly preferences = this.accountPreferences.performance;
    readonly preferencesLoading = this.accountPreferences.loading;
    readonly syncWarning = this.accountPreferences.syncWarning;
    readonly storageWarning = this.accountPreferences.storageWarning;
    readonly event = signal<PerformanceAlertEvent | null>(null);
    readonly anyEnabled = computed(() => Object.values(this.preferences()).some(rule => rule.enabled));

    private owner: string | null = null;
    private context = '';
    private rules = '';
    private previous: PerformanceMetrics | null = null;
    private fired = new Set<string>();
    private liveBaselineSignature = '';
    private liveTradeBaselines = new Map<string, number>();
    private eventSequence = 0;
    private dismissTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            if (owner !== this.owner) {
                this.owner = owner;
                this.resetEvaluation();
            }
        });

        effect(() => {
            const shouldMonitor = !!this.session.userId()
                && this.userData.dataLoaded()
                && !cacheSuspended()
                && this.anyEnabled();
            this.live.setRequested(shouldMonitor);
        });

        effect(() => {
            const owner = this.session.userId();
            const loaded = this.userData.dataLoaded();
            const suspended = cacheSuspended();
            const filter = this.filters.filters();
            const selected = filter.accountSelectionActive ? [...filter.accountIds].sort() : [];
            const scopedTrades = this.trades.trades().filter(trade =>
                trade.userId === owner && (!filter.accountSelectionActive || selected.includes(trade.accountId || '0')));
            const liveMetrics = this.selectedLiveMetrics(this.live.metrics(), filter.accountSelectionActive, selected);
            const liveBaselineSignature = liveMetrics.map(metric => metric.baselineKey).sort().join('|');
            const current = this.mergeLiveMetrics(scopedTrades, liveMetrics);
            const context = `${owner ?? ''}:${filter.accountSelectionActive ? selected.join(',') : 'all'}:${current.day}:${current.week}`;
            const rules = JSON.stringify(this.preferences());

            // Loading, account/filter changes, a new period, and settings edits
            // establish a baseline; they never replay historical achievements.
            const contextChanged = context !== this.context;
            const rulesChanged = rules !== this.rules;
            if (!owner || !loaded || suspended || contextChanged || rulesChanged
                || liveBaselineSignature !== this.liveBaselineSignature || !this.previous) {
                this.context = context;
                this.rules = rules;
                this.liveBaselineSignature = liveBaselineSignature;
                this.previous = current;
                // A stream reconnect establishes a new live baseline but must
                // not replay a threshold that already fired this day/week.
                if (contextChanged || rulesChanged || !owner) this.fired.clear();
                return;
            }

            const crossed = crossedPerformanceAlerts(this.previous, current, this.preferences())
                .filter(alert => !this.fired.has(`${context}:${alert.rule}`));
            this.previous = current;
            if (!crossed.length) return;

            for (const alert of crossed) this.fired.add(`${context}:${alert.rule}`);
            const tone = crossed.some(alert => alert.tone === 'risk') ? 'risk' : 'target';
            const text = crossed.map(alert => alert.text).join(' ');
            this.publish(tone, text);
        });
    }

    setEnabled(rule: PerformanceAlertRule, enabled: boolean): void {
        this.accountPreferences.updatePerformance(current => ({
            ...current,
            [rule]: { ...current[rule], enabled },
        }));
    }

    setValue(rule: PerformanceAlertRule, value: number): void {
        if (!Number.isFinite(value)) return;
        const count = rule === 'dailyTrades';
        const normalized = count
            ? Math.round(Math.max(1, Math.min(1000, value)))
            : Math.round(Math.max(1, Math.min(10_000_000, value)) * 100) / 100;
        this.accountPreferences.updatePerformance(current => ({
            ...current,
            [rule]: { ...current[rule], value: normalized },
        }));
    }

    dismiss(): void {
        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
        this.event.set(null);
    }

    private publish(tone: 'target' | 'risk', text: string): void {
        this.sounds.announce(tone, text);
        this.alertCenter.publish({
            tone,
            title: tone === 'risk' ? 'Guardrail reached' : 'Target reached',
            text,
        });
        this.event.set({ id: ++this.eventSequence, tone, text });
        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = setTimeout(() => this.event.set(null), 12_000);
    }

    private resetEvaluation(): void {
        this.context = '';
        this.rules = '';
        this.liveBaselineSignature = '';
        this.liveTradeBaselines.clear();
        this.previous = null;
        this.fired.clear();
        this.dismiss();
    }

    private selectedLiveMetrics(
        metrics: TradovateLiveAccountMetric[],
        selectionActive: boolean | undefined,
        selected: string[],
    ): TradovateLiveAccountMetric[] {
        const selectedSet = new Set(selected);
        const newestByAccount = new Map<number, TradovateLiveAccountMetric>();
        for (const metric of metrics) {
            if (selectionActive && !selectedSet.has(String(metric.accountId))) continue;
            const current = newestByAccount.get(metric.accountId);
            if (!current || metric.updatedAt > current.updatedAt) newestByAccount.set(metric.accountId, metric);
        }
        return [...newestByAccount.values()];
    }

    /** Overlay authoritative live broker P&L while retaining DB metrics for
     *  historical/manual accounts. The max() count prevents a later report
     *  sync from double-counting a position already observed on the stream. */
    private mergeLiveMetrics(trades: Parameters<typeof performanceMetrics>[0], live: TradovateLiveAccountMetric[]): PerformanceMetrics {
        const current = performanceMetrics(trades);
        const activeKeys = new Set(live.map(metric => metric.baselineKey));
        for (const key of this.liveTradeBaselines.keys()) {
            if (!activeKeys.has(key)) this.liveTradeBaselines.delete(key);
        }

        for (const metric of live) {
            const accountTrades = trades.filter(trade => trade.accountId === String(metric.accountId));
            const persisted = performanceMetrics(accountTrades);
            if (!this.liveTradeBaselines.has(metric.baselineKey)) {
                this.liveTradeBaselines.set(metric.baselineKey, persisted.dailyTrades);
            }

            if (metric.tradeDate === current.day) {
                if (metric.dailyPnl !== null) current.dailyPnl += metric.dailyPnl - persisted.dailyPnl;
                const baseline = this.liveTradeBaselines.get(metric.baselineKey) ?? persisted.dailyTrades;
                const liveCount = Math.max(persisted.dailyTrades, baseline + metric.completedTrades);
                current.dailyTrades += liveCount - persisted.dailyTrades;
            }
            if (metric.tradeDate && weekStartFor(metric.tradeDate) === current.week && metric.weeklyPnl !== null) {
                current.weeklyPnl += metric.weeklyPnl - persisted.weeklyPnl;
            }
        }
        return current;
    }
}
