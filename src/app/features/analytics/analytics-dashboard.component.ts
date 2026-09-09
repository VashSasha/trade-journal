import {
    AfterViewInit,
    Component,
    DestroyRef,
    effect,
    inject,
    signal,
    ViewChild,
} from '@angular/core';
import { GridItemHTMLElement, GridStackWidget } from 'gridstack';
import { GridstackComponent, NgGridStackOptions, nodesCB } from 'gridstack/dist/angular';
import { FilterToolbarComponent } from '../dashboard/components/filter-toolbar/filter-toolbar.component';
import { AdvancedStatsBarComponent } from './components/advanced-stats-bar/advanced-stats-bar.component';
import { AnalyticsLensComponent } from './components/analytics-lens/analytics-lens.component';
import { AnalyticsDataService } from './analytics-data.service';
import {
    ANALYTICS_WIDGETS,
    AnalyticsWidgetId,
    AnalyticsWidgetPlacement,
    analyticsWidgetDefinition,
} from './analytics-layout.model';
import { AnalyticsLayoutService } from './analytics-layout.service';
import { ANALYTICS_WIDGET_COMPONENTS } from './widgets/analytics-widgets';

@Component({
    selector: 'app-analytics-dashboard',
    standalone: true,
    imports: [
        FilterToolbarComponent,
        AdvancedStatsBarComponent,
        AnalyticsLensComponent,
        GridstackComponent,
    ],
    providers: [AnalyticsDataService, AnalyticsLayoutService],
    templateUrl: './analytics-dashboard.component.html',
    styleUrl: './analytics-dashboard.component.scss',
})
export class AnalyticsDashboardComponent implements AfterViewInit {
    private readonly destroyRef = inject(DestroyRef);
    readonly data = inject(AnalyticsDataService);
    readonly layout = inject(AnalyticsLayoutService);
    readonly widgetDefinitions = ANALYTICS_WIDGETS;
    readonly canArrange = signal(false);
    readonly gridOptions: NgGridStackOptions;
    private readonly gridReady = signal(false);
    private applyingLayout = false;
    private gridResizeObserver?: ResizeObserver;
    private widgetContentResizeObserver?: ResizeObserver;

    @ViewChild(GridstackComponent) private gridComponent?: GridstackComponent;

    constructor() {
        GridstackComponent.registerComponents([...ANALYTICS_WIDGET_COMPONENTS]);
        this.gridOptions = {
            column: 12,
            cellHeight: 54,
            margin: 12,
            minRow: 1,
            animate: true,
            float: false,
            sizeToContent: true,
            disableDrag: true,
            disableResize: true,
            handle: '.analytics-widget-frame__drag-handle',
            columnOpts: {
                breakpoints: [
                    { w: 640, c: 1, layout: 'list' },
                    { w: 840, c: 6, layout: 'moveScale' },
                ],
                layout: 'moveScale',
            },
            children: this.toGridWidgets(this.layout.widgets()),
        };

        effect(() => {
            const widgets = this.layout.widgets();
            if (!this.gridReady()) return;
            this.applyLayout(widgets);
        });
        effect(() => {
            const editing = this.layout.editing();
            const canArrange = this.canArrange();
            if (!this.gridReady()) return;
            this.gridComponent?.grid
                ?.enableMove(editing && canArrange)
                .enableResize(editing && canArrange);
        });

        this.destroyRef.onDestroy(() => {
            this.gridResizeObserver?.disconnect();
            this.widgetContentResizeObserver?.disconnect();
        });
    }

    ngAfterViewInit(): void {
        this.gridReady.set(true);
        const gridElement = this.gridComponent?.el;
        if (!gridElement) return;

        const updateArrangeMode = () => {
            const grid = this.gridComponent?.grid;
            this.canArrange.set(gridElement.clientWidth > 840 && grid?.getColumn() === 12);
        };
        updateArrangeMode();

        if (typeof ResizeObserver !== 'undefined') {
            this.gridResizeObserver = new ResizeObserver(() => {
                window.requestAnimationFrame(updateArrangeMode);
            });
            this.gridResizeObserver.observe(gridElement);

            this.widgetContentResizeObserver = new ResizeObserver(entries => {
                const items = new Set<GridItemHTMLElement>();
                for (const entry of entries) {
                    const item = (entry.target as HTMLElement).closest('.grid-stack-item');
                    if (item) items.add(item as GridItemHTMLElement);
                }
                window.requestAnimationFrame(() => {
                    const grid = this.gridComponent?.grid;
                    if (!grid) return;
                    for (const item of items) grid.resizeToContent(item);
                });
            });
        }
        this.scheduleContentFit();
    }

    toggleEditing(): void {
        this.layout.editing.update(editing => !editing);
    }

    setWidgetVisible(id: AnalyticsWidgetId, visible: boolean): void {
        this.layout.setVisible(id, visible);
    }

    onLayoutChange(_data: nodesCB): void {
        if (this.applyingLayout || !this.layout.editing() || !this.canArrange()) return;
        const saved = this.gridComponent?.grid?.save(false, false, undefined, 12);
        if (!Array.isArray(saved)) return;
        this.layout.updatePositions(saved.flatMap(widget => {
            if (typeof widget.id !== 'string') return [];
            const id = widget.id as AnalyticsWidgetId;
            if (!ANALYTICS_WIDGETS.some(definition => definition.id === id)) return [];
            return [{
                id,
                x: widget.x ?? 0,
                y: widget.y ?? 0,
                w: widget.w ?? 1,
                h: widget.h ?? 1,
            }];
        }));
    }

    onResizeStop(): void {
        window.setTimeout(() => {
            this.fitWidgetsToContent();
            window.dispatchEvent(new Event('resize'));
        }, 0);
    }

    private applyLayout(widgets: AnalyticsWidgetPlacement[]): void {
        const grid = this.gridComponent?.grid;
        if (!grid) return;
        this.applyingLayout = true;
        try {
            grid.load(this.toGridWidgets(widgets));
            grid.enableMove(this.layout.editing() && this.canArrange());
            grid.enableResize(this.layout.editing() && this.canArrange());
        } finally {
            window.setTimeout(() => { this.applyingLayout = false; }, 0);
            this.scheduleContentFit();
        }
    }

    private scheduleContentFit(): void {
        window.requestAnimationFrame(() => this.fitWidgetsToContent());
    }

    private fitWidgetsToContent(): void {
        const grid = this.gridComponent?.grid;
        if (!grid) return;
        this.widgetContentResizeObserver?.disconnect();
        for (const item of grid.getGridItems()) {
            const content = item.querySelector<HTMLElement>('.analytics-widget-frame__content');
            if (content) this.widgetContentResizeObserver?.observe(content);
            grid.resizeToContent(item);
        }
    }

    private toGridWidgets(widgets: readonly AnalyticsWidgetPlacement[]): GridStackWidget[] {
        return widgets.filter(widget => !widget.hidden).map(widget => {
            const definition = analyticsWidgetDefinition(widget.id);
            return {
                id: widget.id,
                component: definition.component,
                x: widget.x,
                y: widget.y,
                w: widget.w,
                h: widget.h,
                minW: definition.minW,
                minH: definition.minH,
                maxH: definition.maxH,
                sizeToContent: true,
                resizeToContentParent: '.analytics-widget-frame__body',
            };
        });
    }
}
