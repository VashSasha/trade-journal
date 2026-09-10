import {
    TradovateLiveAccountMetric,
    TradovateLivePositionEvent,
    TradovateLivePositionEventKind,
} from '../integrations/tradovate-live/tradovate-live.models';
import {
    DEFAULT_LIVE_COACH_PREFERENCES,
    LiveCoachAiPayload,
    LiveCoachNarration,
    LiveCoachPreferences,
} from './live-coach.models';
import { Trade } from '../../core/models/trade.model';
import { inferTradeDecisions } from '../../core/utils/trade-decisions.utils';
import { tradeSessionDateStr } from '../../core/utils/market-holidays';
import { performanceMetrics } from '../alerts/performance-alerts.utils';
import { DEFAULT_LIVE_COACH_VOICE, isLiveCoachVoice } from './live-coach-voices';

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
}

export function parseLiveCoachPreferences(raw: string | null): LiveCoachPreferences {
    try {
        const value: unknown = JSON.parse(raw ?? 'null');
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value as Partial<LiveCoachPreferences>
            : {};
        return {
            enabled: source.enabled === true,
            aiCommentary: source.aiCommentary === true,
            voice: isLiveCoachVoice(source.voice) ? source.voice : DEFAULT_LIVE_COACH_VOICE,
            entries: source.entries !== false,
            sizing: source.sizing !== false,
            exits: source.exits !== false,
            guardrails: source.guardrails !== false,
            cooldownSeconds: Math.round(boundedNumber(
                source.cooldownSeconds,
                DEFAULT_LIVE_COACH_PREFERENCES.cooldownSeconds,
                5,
                60,
            )),
            speechRate: Math.round(boundedNumber(
                source.speechRate,
                DEFAULT_LIVE_COACH_PREFERENCES.speechRate,
                0.8,
                1.2,
            ) * 10) / 10,
        };
    } catch {
        return { ...DEFAULT_LIVE_COACH_PREFERENCES };
    }
}

export function liveCoachEventEnabled(
    kind: TradovateLivePositionEventKind,
    preferences: LiveCoachPreferences,
): boolean {
    if (kind === 'opened') return preferences.entries;
    if (kind === 'increased' || kind === 'reduced') return preferences.sizing;
    return preferences.exits;
}

/** Open + rapid scale-ins share a bucket; copied-account updates are coalesced. */
export function liveCoachEventBucket(event: TradovateLivePositionEvent): string {
    const lifecycle = event.kind === 'closed' || event.kind === 'reversed' ? 'exit' : 'exposure';
    const instrument = event.contractId === null
        ? `${event.connectionId}:${event.positionId}`
        : String(event.contractId);
    return `${instrument}:${lifecycle}:${event.direction}`;
}

export function buildLiveCoachNarration(
    events: readonly TradovateLivePositionEvent[],
    contractName?: string | null,
): LiveCoachNarration | null {
    if (!events.length) return null;
    const ordered = [...events].sort((a, b) => a.observedAt - b.observedAt);
    const accounts = new Map<number, { first: TradovateLivePositionEvent; latest: TradovateLivePositionEvent }>();
    for (const event of ordered) {
        const current = accounts.get(event.accountId);
        if (current) current.latest = event;
        else accounts.set(event.accountId, { first: event, latest: event });
    }

    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const previousQuantity = [...accounts.values()].reduce((sum, item) => sum + item.first.previousQuantity, 0);
    const quantity = [...accounts.values()].reduce((sum, item) => sum + item.latest.quantity, 0);
    if (previousQuantity === quantity && latest.kind !== 'reversed') return null;

    const accountCount = accounts.size;
    const accountsText = accountCount > 1 ? ` across ${accountCount} accounts` : '';
    const contract = contractName?.trim() || 'Position';
    const direction = latest.direction;
    const contractWord = (value: number) => `${value} ${value === 1 ? 'contract' : 'contracts'}`;

    let kind: TradovateLivePositionEventKind;
    let title: string;
    let text: string;
    let tone: LiveCoachNarration['tone'] = 'info';

    if (latest.kind === 'reversed') {
        kind = 'reversed';
        title = 'Position reversed';
        text = `${contract} reversed ${direction} with ${contractWord(quantity)}${accountsText}.`;
        tone = 'warning';
    } else if (quantity === 0) {
        kind = 'closed';
        title = 'Position closed';
        text = `Closed ${contract} ${direction}: ${contractWord(previousQuantity)}${accountsText}.`;
    } else if (previousQuantity === 0 || first.kind === 'opened') {
        kind = 'opened';
        title = 'Position opened';
        text = `Opened ${contract} ${direction} with ${contractWord(quantity)}${accountsText}.`;
    } else if (quantity > previousQuantity) {
        kind = 'increased';
        title = 'Position increased';
        text = `${contract} ${direction} increased from ${previousQuantity} to ${contractWord(quantity)}${accountsText}.`;
    } else {
        kind = 'reduced';
        title = 'Position reduced';
        text = `${contract} ${direction} reduced from ${previousQuantity} to ${contractWord(quantity)}${accountsText}.`;
    }

    return {
        key: `${first.contractId ?? first.positionId}:${kind}:${direction}`,
        title,
        text,
        tone,
        kind,
        accountCount,
        previousQuantity,
        quantity,
        personalized: false,
    };
}

/** AI is intentionally reserved for meaningful lifecycle moments, not every tick. */
export function shouldPersonalizeLiveCoachEvent(kind: TradovateLivePositionEventKind): boolean {
    return kind === 'opened' || kind === 'closed' || kind === 'reversed';
}

/**
 * Build aggregate coaching context without user/account identifiers. Copied
 * executions remain visible, but decisionCount is the behavioral trade count.
 */
export function buildLiveCoachAiPayload(
    events: readonly TradovateLivePositionEvent[],
    narration: LiveCoachNarration,
    trades: readonly Trade[],
    liveMetrics: readonly TradovateLiveAccountMetric[],
    symbol: string,
    now = new Date(),
): LiveCoachAiPayload {
    const current = performanceMetrics([...trades], now);
    let dailyPnl = current.dailyPnl;
    let weeklyPnl = current.weeklyPnl;
    const newestByAccount = new Map<number, TradovateLiveAccountMetric>();

    for (const metric of liveMetrics) {
        const existing = newestByAccount.get(metric.accountId);
        if (!existing || metric.updatedAt > existing.updatedAt) newestByAccount.set(metric.accountId, metric);
    }
    for (const metric of newestByAccount.values()) {
        const persisted = performanceMetrics(
            trades.filter(trade => trade.accountId === String(metric.accountId)),
            now,
        );
        if (metric.tradeDate === current.day && metric.dailyPnl !== null) {
            dailyPnl += metric.dailyPnl - persisted.dailyPnl;
        }
        if (metric.tradeDate && metric.tradeDate >= current.week && metric.tradeDate <= current.day
            && metric.weeklyPnl !== null) {
            weeklyPnl += metric.weeklyPnl - persisted.weeklyPnl;
        }
    }

    const dailyTrades = trades.filter(trade => {
        if (trade.status !== 'closed') return false;
        const closedAt = trade.exitDate ?? trade.entryDate;
        return !!closedAt && tradeSessionDateStr(closedAt) === current.day;
    });
    const decisions = inferTradeDecisions(dailyTrades);
    const recentDecisionPnls = decisions.decisions.slice(-5).map(decision => roundMoney(decision.totalPnl));
    let consecutiveLosses = 0;
    for (let index = recentDecisionPnls.length - 1; index >= 0 && recentDecisionPnls[index] < 0; index--) {
        consecutiveLosses++;
    }
    const sizedDecisions = decisions.decisions.filter(decision => decision.maxQuantity > 0).slice(-20);
    const typicalContractsPerAccount = sizedDecisions.length
        ? roundQuantity(sizedDecisions.reduce((total, decision) => total + decision.maxQuantity, 0) / sizedDecisions.length)
        : null;
    const event = events[events.length - 1];

    return {
        observation: {
            kind: narration.kind,
            symbol: symbol.trim().slice(0, 32) || 'Position',
            direction: event.direction,
            previousQuantity: narration.previousQuantity,
            quantity: narration.quantity,
            accountCount: narration.accountCount,
            averagePrice: event.averagePrice === null ? null : roundQuantity(event.averagePrice),
        },
        session: {
            tradeDate: event.tradeDate ?? current.day,
            dailyPnl: roundMoney(dailyPnl),
            weeklyPnl: roundMoney(weeklyPnl),
            executionCount: decisions.executionCount,
            decisionCount: decisions.decisionCount,
            accountCount: decisions.accountCount,
            winRate: roundQuantity(decisions.winRate),
            consecutiveLosses,
            recentDecisionPnls,
            typicalContractsPerAccount,
            currentContractsPerAccount: roundQuantity(narration.quantity / Math.max(1, narration.accountCount)),
        },
    };
}

/** Keep model output short, single-line and safe for speech/alert surfaces. */
export function normalizeLiveCoachAiText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value
        .replace(/[`*_#>\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^['\"]|['\"]$/g, '')
        .trim();
    if (normalized.length < 4) return null;
    if (/(?:^(?:buy|sell|enter|exit|hold|close|add)\b|\b(?:should|must|consider|avoid|do not|don't)\s+(?:buy|sell|enter|exit|hold|close|add)\b|\bgo (?:long|short)\b|\bmove (?:the|your) stop\b)/i.test(normalized)) {
        return null;
    }
    const words = normalized.split(' ').slice(0, 32).join(' ');
    if (words.length <= 220) return words;
    return words.slice(0, 220).replace(/\s+\S*$/, '').trim() || null;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
    return Math.round(value * 100) / 100;
}
