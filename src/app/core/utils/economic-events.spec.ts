import { describe, expect, it } from 'vitest';
import {
    easternDateTimeToTimestamp, economicEventTimestamp, getEconomicEventsForMonth,
} from './economic-events';

describe('economic events', () => {
    it('converts Eastern release times with daylight saving', () => {
        expect(new Date(easternDateTimeToTimestamp('2026-09-09', '08:30')).toISOString())
            .toBe('2026-09-09T12:30:00.000Z');
        expect(new Date(easternDateTimeToTimestamp('2026-12-09', '08:30')).toISOString())
            .toBe('2026-12-09T13:30:00.000Z');
    });

    it('prefers an official UTC instant when one is available', () => {
        expect(economicEventTimestamp({
            event: 'CPI', abbr: 'CPI', date: '2026-01-01', time: '00:00', impact: 'high',
            link: 'https://www.bls.gov/', startsAt: '2026-09-09T12:30:00.000Z',
        })).toBe(Date.parse('2026-09-09T12:30:00.000Z'));
    });

    it('keeps published 2027 FOMC dates available as a network fallback', () => {
        expect(getEconomicEventsForMonth(2027, 8)).toContainEqual(expect.objectContaining({
            abbr: 'FOMC', date: '2027-09-15', estimated: false,
        }));
    });
});
