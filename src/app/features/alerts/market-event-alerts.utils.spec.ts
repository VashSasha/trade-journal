import { describe, expect, it } from 'vitest';
import { EconomicEvent } from '../../core/utils/economic-events';
import {
    crossedMarketEventAlerts, DEFAULT_MARKET_EVENT_ALERTS, parseMarketEventAlertPreferences,
} from './market-event-alerts.utils';

const event: EconomicEvent = {
    id: 'bls:cpi', event: 'Consumer Price Index', abbr: 'CPI', date: '2026-09-09', time: '08:30',
    startsAt: '2026-09-09T12:30:00.000Z', impact: 'high', link: 'https://www.bls.gov/',
};

describe('market event alert utilities', () => {
    it('uses safe defaults for missing or malformed preferences', () => {
        expect(parseMarketEventAlertPreferences(null)).toEqual(DEFAULT_MARKET_EVENT_ALERTS);
        expect(parseMarketEventAlertPreferences('{')).toEqual(DEFAULT_MARKET_EVENT_ALERTS);
        expect(parseMarketEventAlertPreferences(JSON.stringify({ enabled: true, leadMinutes: 999 })))
            .toMatchObject({ enabled: true, leadMinutes: 15, highOnly: true });
    });

    it('fires once when the configured lead-time boundary is crossed', () => {
        const threshold = Date.parse(event.startsAt!) - 15 * 60_000;
        const result = crossedMarketEventAlerts([event], threshold - 1000, threshold + 1000, {
            ...DEFAULT_MARKET_EVENT_ALERTS, enabled: true,
        });
        expect(result).toHaveLength(1);
        expect(result[0].event.abbr).toBe('CPI');
    });

    it('does not replay after a suspended gap or include medium events in high-only mode', () => {
        const threshold = Date.parse(event.startsAt!) - 15 * 60_000;
        expect(crossedMarketEventAlerts([event], threshold - 100_000, threshold + 1000, {
            ...DEFAULT_MARKET_EVENT_ALERTS, enabled: true,
        })).toEqual([]);
        expect(crossedMarketEventAlerts([{ ...event, impact: 'medium' }], threshold - 1000, threshold + 1000, {
            ...DEFAULT_MARKET_EVENT_ALERTS, enabled: true,
        })).toEqual([]);
    });
});
