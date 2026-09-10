import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYTICS_LAYOUT, normalizeAnalyticsLayout } from './analytics-layout.model';

describe('normalizeAnalyticsLayout', () => {
    it('returns a fresh default layout for invalid data', () => {
        const result = normalizeAnalyticsLayout(null);
        expect(result).toEqual(DEFAULT_ANALYTICS_LAYOUT);
        expect(result).not.toBe(DEFAULT_ANALYTICS_LAYOUT);
    });

    it('drops unknown and duplicate widgets and restores missing defaults', () => {
        const result = normalizeAnalyticsLayout([
            { id: 'monthly', x: 0, y: 2, w: 8, h: 7, hidden: true },
            { id: 'monthly', x: 2, y: 4, w: 10, h: 5 },
            { id: 'unknown', x: 0, y: 0, w: 12, h: 3 },
        ]);

        expect(result).toHaveLength(DEFAULT_ANALYTICS_LAYOUT.length);
        expect(result.find(widget => widget.id === 'monthly')).toEqual({
            id: 'monthly', x: 0, y: 2, w: 8, h: 7, hidden: true,
        });
        expect(result.find(widget => widget.id === 'distribution')).toEqual(
            DEFAULT_ANALYTICS_LAYOUT.find(widget => widget.id === 'distribution'),
        );
    });

    it('clamps positions and dimensions to the widget catalog', () => {
        const result = normalizeAnalyticsLayout([
            { id: 'long-short', x: 20, y: -4, w: 2, h: 99 },
        ]);

        expect(result.find(widget => widget.id === 'long-short')).toEqual({
            id: 'long-short', x: 7, y: 0, w: 5, h: 20, hidden: false,
        });
    });

    it('ships without overlapping widgets', () => {
        for (let index = 0; index < DEFAULT_ANALYTICS_LAYOUT.length; index++) {
            const current = DEFAULT_ANALYTICS_LAYOUT[index];
            for (const other of DEFAULT_ANALYTICS_LAYOUT.slice(index + 1)) {
                const overlaps = current.x < other.x + other.w
                    && current.x + current.w > other.x
                    && current.y < other.y + other.h
                    && current.y + current.h > other.y;
                expect(overlaps, `${current.id} overlaps ${other.id}`).toBe(false);
            }
        }
    });
});
