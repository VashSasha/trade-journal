import { computed, inject, Injectable, signal } from '@angular/core';
import { AccountService } from '../../core/services/account.service';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { buildEquityCurve } from '../../core/utils/trade-stats.utils';
import {
    AnalyticsUnit,
    analyticsUnitLabel,
    buildAnalyticsObservations,
} from './utils/analytics-performance.utils';

/** Shared, scoped projections consumed independently by Analytics widgets. */
@Injectable()
export class AnalyticsDataService {
    private readonly filters = inject(FilterService);
    private readonly trades = inject(TradeService);
    private readonly accounts = inject(AccountService);

    readonly unit = signal<AnalyticsUnit>('decision');
    readonly unitLabel = computed(() => analyticsUnitLabel(this.unit()));
    readonly filteredTrades = computed(() => this.filters.filterTrades(this.trades.trades()));
    readonly observations = computed(() =>
        buildAnalyticsObservations(this.filteredTrades(), this.unit()),
    );
    readonly equityBaseline = computed(() => this.accounts.openingBalance());
    readonly equityCurveData = computed(() => {
        const filtered = this.filteredTrades();
        const accountIds = this.filters.filters().accountIds;
        const allClosed = this.trades.trades().filter(trade => {
            if (trade.status !== 'closed' || trade.netPnl === undefined) return false;
            if (accountIds.length > 0 && trade.accountId && trade.accountId !== '0') {
                return accountIds.includes(trade.accountId);
            }
            return true;
        });
        const firstDate = filtered.length > 0
            ? Math.min(...filtered.map(trade => new Date(trade.entryDate).getTime()))
            : Number.POSITIVE_INFINITY;
        const priorPnl = allClosed
            .filter(trade => new Date(trade.entryDate).getTime() < firstDate)
            .reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0);

        return buildEquityCurve(filtered, this.accounts.openingBalance() + priorPnl);
    });
}
