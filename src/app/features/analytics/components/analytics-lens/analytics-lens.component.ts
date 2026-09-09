import { Component, computed, input, output } from '@angular/core';
import { Trade } from '../../../../core/models/trade.model';
import { inferTradeDecisions } from '../../../../core/utils/trade-decisions.utils';
import {
    AnalyticsUnit,
    buildAnalyticsObservations,
} from '../../utils/analytics-performance.utils';

@Component({
    selector: 'app-analytics-lens',
    standalone: true,
    imports: [],
    templateUrl: './analytics-lens.component.html',
    styleUrl: './analytics-lens.component.scss',
})
export class AnalyticsLensComponent {
    readonly trades = input.required<Trade[]>();
    readonly unit = input<AnalyticsUnit>('decision');
    readonly unitChange = output<AnalyticsUnit>();

    readonly activity = computed(() => inferTradeDecisions(
        this.trades().filter(trade =>
            trade.status === 'closed' && Number.isFinite(trade.netPnl ?? trade.pnl),
        ),
    ));
    readonly positions = computed(() => buildAnalyticsObservations(this.trades(), 'position'));
    readonly positionCount = computed(() => this.positions().length);
    readonly hasGroupedActivity = computed(() =>
        this.activity().decisionCount !== this.activity().executionCount
        || this.positionCount() !== this.activity().executionCount,
    );
    readonly description = computed(() => {
        switch (this.unit()) {
            case 'position': return 'Scale-ins and partial exits on one account count once.';
            case 'execution': return 'Every matched broker row counts separately.';
            default: return 'Matching copy-traded executions across accounts count once.';
        }
    });

    select(unit: AnalyticsUnit): void {
        if (unit !== this.unit()) this.unitChange.emit(unit);
    }
}
