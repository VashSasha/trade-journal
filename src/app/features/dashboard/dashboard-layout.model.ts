export const DASHBOARD_LAYOUT_VERSION = 1;

export type DashboardWidgetId =
    | 'stats'
    | 'performance'
    | 'calendar'
    | 'recent-trades'
    | 'goals'
    | 'market-events';

export interface DashboardWidgetDefinition {
    id: DashboardWidgetId;
    label: string;
    description: string;
    component: string;
    minW: number;
    minH: number;
    maxH: number;
}

export interface DashboardWidgetPlacement {
    id: DashboardWidgetId;
    x: number;
    y: number;
    w: number;
    h: number;
    hidden: boolean;
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
    {
        id: 'stats', label: 'Performance stats', description: 'P&L, win rate, trades and profit factor',
        component: 'app-dashboard-stats-widget', minW: 6, minH: 3, maxH: 10,
    },
    {
        id: 'performance', label: 'Performance overview', description: 'Equity curve and win/loss distribution',
        component: 'app-dashboard-performance-widget', minW: 6, minH: 8, maxH: 20,
    },
    {
        id: 'calendar', label: 'Trading calendar', description: 'Daily performance and economic releases',
        component: 'app-dashboard-calendar-widget', minW: 6, minH: 9, maxH: 20,
    },
    {
        id: 'recent-trades', label: 'Recent trades', description: 'Latest trades in the active filters',
        component: 'app-dashboard-recent-trades-widget', minW: 4, minH: 6, maxH: 20,
    },
    {
        id: 'goals', label: 'Goals', description: 'Progress toward your trading targets',
        component: 'app-dashboard-goals-widget', minW: 3, minH: 5, maxH: 30,
    },
    {
        id: 'market-events', label: 'Market awareness', description: 'Upcoming volatility-sensitive releases',
        component: 'app-dashboard-market-events-widget', minW: 6, minH: 5, maxH: 20,
    },
] as const;

export const DEFAULT_DASHBOARD_LAYOUT: readonly DashboardWidgetPlacement[] = [
    { id: 'stats',         x: 0, y: 0,  w: 12, h: 3,  hidden: false },
    { id: 'performance',   x: 0, y: 3,  w: 12, h: 9,  hidden: false },
    { id: 'calendar',      x: 0, y: 12, w: 8,  h: 15, hidden: false },
    { id: 'recent-trades', x: 8, y: 12, w: 4,  h: 16, hidden: false },
    { id: 'goals',         x: 8, y: 28, w: 4,  h: 5,  hidden: false },
    { id: 'market-events', x: 0, y: 33, w: 12, h: 6,  hidden: false },
] as const;

const widgetById = new Map(DASHBOARD_WIDGETS.map(widget => [widget.id, widget]));
const defaultById = new Map(DEFAULT_DASHBOARD_LAYOUT.map(widget => [widget.id, widget]));

function integer(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

/** Accept only known widgets and safe grid bounds, then add defaults introduced by newer releases. */
export function normalizeDashboardLayout(value: unknown): DashboardWidgetPlacement[] {
    const raw = Array.isArray(value) ? value : [];
    const candidates = new Map<DashboardWidgetId, Record<string, unknown>>();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        if (typeof candidate['id'] !== 'string' || !widgetById.has(candidate['id'] as DashboardWidgetId)) continue;
        const id = candidate['id'] as DashboardWidgetId;
        if (!candidates.has(id)) candidates.set(id, candidate);
    }

    return DASHBOARD_WIDGETS.map(definition => {
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

export function dashboardWidgetDefinition(id: DashboardWidgetId): DashboardWidgetDefinition {
    return widgetById.get(id)!;
}
