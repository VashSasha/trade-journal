export const ANALYTICS_LAYOUT_VERSION = 2;

export type AnalyticsWidgetId =
    | 'equity'
    | 'long-short'
    | 'monthly'
    | 'distribution'
    | 'symbol'
    | 'weekday'
    | 'hourly'
    | 'setup';

export interface AnalyticsWidgetDefinition {
    id: AnalyticsWidgetId;
    label: string;
    description: string;
    component: string;
    minW: number;
    minH: number;
    maxH: number;
}

export interface AnalyticsWidgetPlacement {
    id: AnalyticsWidgetId;
    x: number;
    y: number;
    w: number;
    h: number;
    hidden: boolean;
}

export const ANALYTICS_WIDGETS: readonly AnalyticsWidgetDefinition[] = [
    {
        id: 'equity', label: 'Combined equity curve', description: 'Account balance and cumulative P&L',
        component: 'app-analytics-equity-widget', minW: 6, minH: 7, maxH: 20,
    },
    {
        id: 'long-short', label: 'Long vs short', description: 'Direction-level performance comparison',
        component: 'app-analytics-long-short-widget', minW: 5, minH: 7, maxH: 20,
    },
    {
        id: 'monthly', label: 'Monthly performance', description: 'Monthly consistency and yearly totals',
        component: 'app-analytics-monthly-widget', minW: 8, minH: 4, maxH: 30,
    },
    {
        id: 'distribution', label: 'P&L distribution', description: 'Outcome range, frequency, and profit concentration',
        component: 'app-analytics-distribution-widget', minW: 6, minH: 7, maxH: 20,
    },
    {
        id: 'symbol', label: 'Performance by symbol', description: 'Results across traded markets',
        component: 'app-analytics-symbol-widget', minW: 5, minH: 6, maxH: 20,
    },
    {
        id: 'weekday', label: 'Performance by trading day', description: 'Average P&L and win rate by weekday',
        component: 'app-analytics-weekday-widget', minW: 5, minH: 6, maxH: 20,
    },
    {
        id: 'hourly', label: 'Performance by entry hour', description: 'Time-of-day performance patterns',
        component: 'app-analytics-hourly-widget', minW: 5, minH: 6, maxH: 20,
    },
    {
        id: 'setup', label: 'Performance by setup', description: 'Results across tagged setups',
        component: 'app-analytics-setup-widget', minW: 5, minH: 6, maxH: 20,
    },
] as const;

export const DEFAULT_ANALYTICS_LAYOUT: readonly AnalyticsWidgetPlacement[] = [
    { id: 'equity',     x: 0, y: 0,  w: 7,  h: 7, hidden: false },
    { id: 'long-short', x: 7, y: 0,  w: 5,  h: 7, hidden: false },
    { id: 'monthly',    x: 0, y: 7,  w: 12, h: 4, hidden: false },
    { id: 'distribution', x: 0, y: 23, w: 12, h: 7, hidden: false },
    { id: 'symbol',     x: 0, y: 11, w: 6,  h: 6, hidden: false },
    { id: 'weekday',    x: 6, y: 11, w: 6,  h: 6, hidden: false },
    { id: 'hourly',     x: 0, y: 17, w: 6,  h: 6, hidden: false },
    { id: 'setup',      x: 6, y: 17, w: 6,  h: 6, hidden: false },
] as const;

const widgetById = new Map(ANALYTICS_WIDGETS.map(widget => [widget.id, widget]));
const defaultById = new Map(DEFAULT_ANALYTICS_LAYOUT.map(widget => [widget.id, widget]));

function integer(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

/** Reject unknown widgets and unsafe grid values, then restore newly introduced defaults. */
export function normalizeAnalyticsLayout(value: unknown): AnalyticsWidgetPlacement[] {
    const raw = Array.isArray(value) ? value : [];
    const candidates = new Map<AnalyticsWidgetId, Record<string, unknown>>();

    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        if (typeof candidate['id'] !== 'string'
            || !widgetById.has(candidate['id'] as AnalyticsWidgetId)) continue;
        const id = candidate['id'] as AnalyticsWidgetId;
        if (!candidates.has(id)) candidates.set(id, candidate);
    }

    return ANALYTICS_WIDGETS.map(definition => {
        const fallback = defaultById.get(definition.id)!;
        const candidate = candidates.get(definition.id);
        if (!candidate) return { ...fallback };
        const w = Math.min(12, Math.max(definition.minW, integer(candidate['w'], fallback.w)));
        const h = Math.min(definition.maxH, Math.max(definition.minH, integer(candidate['h'], fallback.h)));
        const x = Math.min(12 - w, Math.max(0, integer(candidate['x'], fallback.x)));
        const y = Math.min(200, Math.max(0, integer(candidate['y'], fallback.y)));
        return { id: definition.id, x, y, w, h, hidden: candidate['hidden'] === true };
    });
}

export function analyticsWidgetDefinition(id: AnalyticsWidgetId): AnalyticsWidgetDefinition {
    return widgetById.get(id)!;
}
