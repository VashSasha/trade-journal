import { EconomicEvent, economicEventTimestamp } from '../../core/utils/economic-events';

export interface MarketEventAlertPreferences {
    enabled: boolean;
    leadMinutes: 5 | 10 | 15 | 30 | 60;
    highOnly: boolean;
    desktopNotifications: boolean;
}

export interface MarketEventAlert {
    key: string;
    event: EconomicEvent;
    thresholdAt: number;
}

export const MARKET_EVENT_LEADS = [5, 10, 15, 30, 60] as const;
export const DEFAULT_MARKET_EVENT_ALERTS: Readonly<MarketEventAlertPreferences> = {
    enabled: false,
    leadMinutes: 15,
    highOnly: true,
    desktopNotifications: false,
};
export const MAX_MARKET_ALERT_GAP_MS = 90_000;

export function parseMarketEventAlertPreferences(raw: string | null): MarketEventAlertPreferences {
    try {
        const value: unknown = JSON.parse(raw ?? 'null');
        if (!value || typeof value !== 'object') return { ...DEFAULT_MARKET_EVENT_ALERTS };
        const candidate = value as Partial<MarketEventAlertPreferences>;
        const leadMinutes = MARKET_EVENT_LEADS.includes(candidate.leadMinutes as typeof MARKET_EVENT_LEADS[number])
            ? candidate.leadMinutes as MarketEventAlertPreferences['leadMinutes']
            : DEFAULT_MARKET_EVENT_ALERTS.leadMinutes;
        return {
            enabled: candidate.enabled === true,
            leadMinutes,
            highOnly: candidate.highOnly !== false,
            desktopNotifications: candidate.desktopNotifications === true,
        };
    } catch {
        return { ...DEFAULT_MARKET_EVENT_ALERTS };
    }
}

/** Boundaries only: a sleeping/new tab never replays events it did not observe. */
export function crossedMarketEventAlerts(
    events: EconomicEvent[],
    previousAt: number,
    now: number,
    preferences: MarketEventAlertPreferences,
): MarketEventAlert[] {
    if (!preferences.enabled || !Number.isFinite(now) || now <= previousAt
        || now - previousAt > MAX_MARKET_ALERT_GAP_MS) return [];
    const lead = preferences.leadMinutes * 60_000;
    return events.flatMap(event => {
        if (preferences.highOnly && event.impact !== 'high') return [];
        const startsAt = economicEventTimestamp(event);
        const thresholdAt = startsAt - lead;
        if (!Number.isFinite(startsAt) || startsAt <= now || thresholdAt <= previousAt || thresholdAt > now) return [];
        return [{ key: `${event.id ?? `${event.abbr}:${event.date}:${event.time}`}:${preferences.leadMinutes}`, event, thresholdAt }];
    }).sort((a, b) => a.thresholdAt - b.thresholdAt || a.key.localeCompare(b.key));
}
