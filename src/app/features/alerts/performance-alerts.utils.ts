import { Trade } from '../../core/models/trade.model';
import { tradeSessionDateStr } from '../../core/utils/market-holidays';

export type PerformanceAlertRule = 'dailyProfit' | 'dailyLoss' | 'weeklyProfit' | 'weeklyLoss' | 'dailyTrades';

export interface AlertThreshold {
    enabled: boolean;
    value: number;
}

export interface PerformanceAlertPreferences {
    dailyProfit: AlertThreshold;
    dailyLoss: AlertThreshold;
    weeklyProfit: AlertThreshold;
    weeklyLoss: AlertThreshold;
    dailyTrades: AlertThreshold;
}

export interface PerformanceMetrics {
    day: string;
    week: string;
    dailyPnl: number;
    weeklyPnl: number;
    dailyTrades: number;
}

export interface CrossedPerformanceAlert {
    rule: PerformanceAlertRule;
    tone: 'target' | 'risk';
    text: string;
}

export const DEFAULT_PERFORMANCE_ALERTS: Readonly<PerformanceAlertPreferences> = {
    dailyProfit: { enabled: false, value: 500 },
    dailyLoss: { enabled: false, value: 300 },
    weeklyProfit: { enabled: false, value: 1500 },
    weeklyLoss: { enabled: false, value: 750 },
    dailyTrades: { enabled: false, value: 10 },
};

function threshold(value: unknown, fallback: AlertThreshold, count = false): AlertThreshold {
    const candidate = value && typeof value === 'object' ? value as Partial<AlertThreshold> : {};
    const raw = typeof candidate.value === 'number' && Number.isFinite(candidate.value)
        ? candidate.value : fallback.value;
    return {
        enabled: candidate.enabled === true,
        value: count ? Math.round(Math.max(1, Math.min(1000, raw))) : Math.round(Math.max(1, Math.min(10_000_000, raw)) * 100) / 100,
    };
}

export function parsePerformanceAlertPreferences(raw: string | null): PerformanceAlertPreferences {
    try {
        const value: unknown = JSON.parse(raw ?? 'null');
        const source = value && typeof value === 'object' ? value as Partial<PerformanceAlertPreferences> : {};
        return {
            dailyProfit: threshold(source.dailyProfit, DEFAULT_PERFORMANCE_ALERTS.dailyProfit),
            dailyLoss: threshold(source.dailyLoss, DEFAULT_PERFORMANCE_ALERTS.dailyLoss),
            weeklyProfit: threshold(source.weeklyProfit, DEFAULT_PERFORMANCE_ALERTS.weeklyProfit),
            weeklyLoss: threshold(source.weeklyLoss, DEFAULT_PERFORMANCE_ALERTS.weeklyLoss),
            dailyTrades: threshold(source.dailyTrades, DEFAULT_PERFORMANCE_ALERTS.dailyTrades, true),
        };
    } catch {
        return structuredClone(DEFAULT_PERFORMANCE_ALERTS);
    }
}

function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function weekStartFor(day: string): string {
    const date = new Date(`${day}T12:00:00`);
    const offset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - offset);
    return dateKey(date);
}

/** Metrics use the same 5pm session-day attribution as Journal and Calendar. */
export function performanceMetrics(trades: Trade[], now = new Date()): PerformanceMetrics {
    const day = tradeSessionDateStr(now.toISOString());
    const week = weekStartFor(day);
    let dailyPnl = 0;
    let weeklyPnl = 0;
    let dailyTrades = 0;

    for (const trade of trades) {
        if (trade.status !== 'closed') continue;
        const closedAt = trade.exitDate ?? trade.entryDate;
        if (!closedAt) continue;
        const tradeDay = tradeSessionDateStr(closedAt);
        const pnl = trade.netPnl ?? trade.pnl ?? 0;
        if (tradeDay >= week && tradeDay <= day) weeklyPnl += pnl;
        if (tradeDay === day) {
            dailyPnl += pnl;
            dailyTrades++;
        }
    }
    return { day, week, dailyPnl, weeklyPnl, dailyTrades };
}

export function crossedPerformanceAlerts(
    previous: PerformanceMetrics,
    current: PerformanceMetrics,
    preferences: PerformanceAlertPreferences,
): CrossedPerformanceAlert[] {
    if (previous.day !== current.day || previous.week !== current.week) return [];
    const alerts: CrossedPerformanceAlert[] = [];
    const crossedUp = (before: number, after: number, target: number) => before < target && after >= target;
    const crossedDown = (before: number, after: number, limit: number) => before > -limit && after <= -limit;
    const money = (value: number) => new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(value);

    if (preferences.dailyLoss.enabled && crossedDown(previous.dailyPnl, current.dailyPnl, preferences.dailyLoss.value)) {
        alerts.push({ rule: 'dailyLoss', tone: 'risk', text: `Daily loss limit reached at ${money(current.dailyPnl)}.` });
    }
    if (preferences.weeklyLoss.enabled && crossedDown(previous.weeklyPnl, current.weeklyPnl, preferences.weeklyLoss.value)) {
        alerts.push({ rule: 'weeklyLoss', tone: 'risk', text: `Weekly loss limit reached at ${money(current.weeklyPnl)}.` });
    }
    if (preferences.dailyTrades.enabled && crossedUp(previous.dailyTrades, current.dailyTrades, preferences.dailyTrades.value)) {
        alerts.push({ rule: 'dailyTrades', tone: 'risk', text: `Daily trade limit reached: ${current.dailyTrades} completed trades.` });
    }
    if (preferences.dailyProfit.enabled && crossedUp(previous.dailyPnl, current.dailyPnl, preferences.dailyProfit.value)) {
        alerts.push({ rule: 'dailyProfit', tone: 'target', text: `Daily profit target reached at ${money(current.dailyPnl)}.` });
    }
    if (preferences.weeklyProfit.enabled && crossedUp(previous.weeklyPnl, current.weeklyPnl, preferences.weeklyProfit.value)) {
        alerts.push({ rule: 'weeklyProfit', tone: 'target', text: `Weekly profit target reached at ${money(current.weeklyPnl)}.` });
    }
    return alerts;
}
