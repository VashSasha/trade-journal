import { Injectable } from '@angular/core';
import { PersistedWidgetLayoutService } from '../../core/services/persisted-widget-layout.service';
import {
    ANALYTICS_LAYOUT_VERSION,
    AnalyticsWidgetPlacement,
    DEFAULT_ANALYTICS_LAYOUT,
    normalizeAnalyticsLayout,
} from './analytics-layout.model';

@Injectable()
export class AnalyticsLayoutService extends PersistedWidgetLayoutService<AnalyticsWidgetPlacement> {
    constructor() {
        super({
            page: 'analytics',
            schemaVersion: ANALYTICS_LAYOUT_VERSION,
            cachePrefix: 'nvzn_analytics_layout_v1:',
            defaultLayout: DEFAULT_ANALYTICS_LAYOUT,
            normalize: normalizeAnalyticsLayout,
        });
    }
}
