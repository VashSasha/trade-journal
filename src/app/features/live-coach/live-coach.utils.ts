import {
    TradovateLivePositionEvent,
    TradovateLivePositionEventKind,
} from '../integrations/tradovate-live/tradovate-live.models';
import {
    DEFAULT_LIVE_COACH_PREFERENCES,
    LiveCoachNarration,
    LiveCoachPreferences,
} from './live-coach.models';

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
    };
}
