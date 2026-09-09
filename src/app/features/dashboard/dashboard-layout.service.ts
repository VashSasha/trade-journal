import { Injectable } from '@angular/core';
import { PersistedWidgetLayoutService } from '../../core/services/persisted-widget-layout.service';
import {
    DASHBOARD_LAYOUT_VERSION,
    DashboardWidgetPlacement,
    DEFAULT_DASHBOARD_LAYOUT,
    normalizeDashboardLayout,
} from './dashboard-layout.model';

const CACHE_PREFIX = 'nvzn_dashboard_layout_v1:';
const PAGE = 'dashboard';

/** Owner-scoped dashboard layout with immediate local persistence and debounced cloud sync. */
@Injectable()
export class DashboardLayoutService extends PersistedWidgetLayoutService<DashboardWidgetPlacement> {
    constructor() {
        super({
            page: PAGE,
            schemaVersion: DASHBOARD_LAYOUT_VERSION,
            cachePrefix: CACHE_PREFIX,
            defaultLayout: DEFAULT_DASHBOARD_LAYOUT,
            normalize: normalizeDashboardLayout,
        });
    }
}
