import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { UserDataService } from '../../core/services/user-data/user-data.service';
import { UserSessionService } from '../../core/services/user-session.service';
import { cacheSuspended } from '../../core/services/user-data/user-data.cache';
import { SessionAlertsService } from './session-alerts.service';
import {
    crossedPerformanceAlerts, parsePerformanceAlertPreferences, performanceMetrics,
    PerformanceAlertPreferences, PerformanceAlertRule, PerformanceMetrics,
} from './performance-alerts.utils';

const STORAGE_PREFIX = 'nvzn_performance_alert_preferences_v1:';

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

    readonly preferences = signal(parsePerformanceAlertPreferences(null));
    readonly event = signal<PerformanceAlertEvent | null>(null);
    readonly anyEnabled = computed(() => Object.values(this.preferences()).some(rule => rule.enabled));

    private owner: string | null = null;
    private context = '';
    private rules = '';
    private previous: PerformanceMetrics | null = null;
    private fired = new Set<string>();
    private eventSequence = 0;
    private dismissTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            if (owner !== this.owner) {
                this.owner = owner;
                this.preferences.set(this.load(owner));
                this.resetEvaluation();
            }
        });

        effect(() => {
            const owner = this.session.userId();
            const loaded = this.userData.dataLoaded();
            const suspended = cacheSuspended();
            const filter = this.filters.filters();
            const selected = filter.accountSelectionActive ? [...filter.accountIds].sort() : [];
            const scopedTrades = this.trades.trades().filter(trade =>
                trade.userId === owner && (!filter.accountSelectionActive || selected.includes(trade.accountId || '0')));
            const current = performanceMetrics(scopedTrades);
            const context = `${owner ?? ''}:${filter.accountSelectionActive ? selected.join(',') : 'all'}:${current.day}:${current.week}`;
            const rules = JSON.stringify(this.preferences());

            // Loading, account/filter changes, a new period, and settings edits
            // establish a baseline; they never replay historical achievements.
            if (!owner || !loaded || suspended || context !== this.context || rules !== this.rules || !this.previous) {
                this.context = context;
                this.rules = rules;
                this.previous = current;
                this.fired.clear();
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
        this.preferences.update(current => ({
            ...current,
            [rule]: { ...current[rule], enabled },
        }));
        this.persist();
    }

    setValue(rule: PerformanceAlertRule, value: number): void {
        if (!Number.isFinite(value)) return;
        const count = rule === 'dailyTrades';
        const normalized = count
            ? Math.round(Math.max(1, Math.min(1000, value)))
            : Math.round(Math.max(1, Math.min(10_000_000, value)) * 100) / 100;
        this.preferences.update(current => ({
            ...current,
            [rule]: { ...current[rule], value: normalized },
        }));
        this.persist();
    }

    dismiss(): void {
        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
        this.event.set(null);
    }

    private publish(tone: 'target' | 'risk', text: string): void {
        this.sounds.announce(tone, text);
        this.event.set({ id: ++this.eventSequence, tone, text });
        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = setTimeout(() => this.event.set(null), 12_000);
    }

    private resetEvaluation(): void {
        this.context = '';
        this.rules = '';
        this.previous = null;
        this.fired.clear();
        this.dismiss();
    }

    private load(owner: string | null): PerformanceAlertPreferences {
        if (!owner) return parsePerformanceAlertPreferences(null);
        try { return parsePerformanceAlertPreferences(localStorage.getItem(STORAGE_PREFIX + owner)); }
        catch { return parsePerformanceAlertPreferences(null); }
    }

    private persist(): void {
        if (!this.owner) return;
        try { localStorage.setItem(STORAGE_PREFIX + this.owner, JSON.stringify(this.preferences())); }
        catch { /* Browser-local preferences remain active for this page. */ }
    }
}
