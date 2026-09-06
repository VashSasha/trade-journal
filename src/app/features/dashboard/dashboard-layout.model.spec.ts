import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD_LAYOUT, normalizeDashboardLayout } from './dashboard-layout.model';

describe('normalizeDashboardLayout', () => {
    it('returns a fresh default layout for invalid data', () => {
        const result = normalizeDashboardLayout(null);
        expect(result).toEqual(DEFAULT_DASHBOARD_LAYOUT);
        expect(result).not.toBe(DEFAULT_DASHBOARD_LAYOUT);
    });

    it('drops unknown and duplicate widgets and restores missing widgets', () => {
        const result = normalizeDashboardLayout([
            { id: 'goals', x: 0, y: 1, w: 5, h: 7, hidden: true },
            { id: 'goals', x: 9, y: 9, w: 3, h: 5 },
            { id: 'unknown', x: 0, y: 0, w: 12, h: 3 },
        ]);
        expect(result).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length);
        expect(result.find(widget => widget.id === 'goals')).toEqual({
            id: 'goals', x: 0, y: 1, w: 5, h: 7, hidden: true,
        });
    });

    it('clamps position and size to each widget definition', () => {
        const result = normalizeDashboardLayout([
            { id: 'recent-trades', x: 20, y: -2, w: 20, h: 2 },
        ]);
        expect(result.find(widget => widget.id === 'recent-trades')).toEqual({
            id: 'recent-trades', x: 0, y: 0, w: 12, h: 6, hidden: false,
        });
    });

    it('allows analytical widgets to share a row at half width', () => {
        const result = normalizeDashboardLayout([
            { id: 'performance', x: 0, y: 0, w: 6, h: 10 },
            { id: 'market-events', x: 6, y: 0, w: 6, h: 10 },
        ]);

        expect(result.find(widget => widget.id === 'performance')).toMatchObject({ x: 0, w: 6 });
        expect(result.find(widget => widget.id === 'market-events')).toMatchObject({ x: 6, w: 6 });
    });

    it('ships a default layout without intersecting widgets', () => {
        for (let i = 0; i < DEFAULT_DASHBOARD_LAYOUT.length; i++) {
            const current = DEFAULT_DASHBOARD_LAYOUT[i];
            for (const other of DEFAULT_DASHBOARD_LAYOUT.slice(i + 1)) {
                const overlaps = current.x < other.x + other.w
                    && current.x + current.w > other.x
                    && current.y < other.y + other.h
                    && current.y + current.h > other.y;
                expect(overlaps, `${current.id} overlaps ${other.id}`).toBe(false);
            }
        }
    });
});
