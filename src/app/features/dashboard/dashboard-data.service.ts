import { computed, inject, Injectable } from '@angular/core';
import { AccountService } from '../../core/services/account.service';
import { FilterService } from '../../core/services/filter.service';
import { TradeService } from '../../core/services/trade.service';
import { tradeSessionDateStr } from '../../core/utils/market-holidays';
import {
    buildPerformanceEquityCurve,
    computeWindowedBalance,
    EquityCurveGrouping,
} from '../../core/utils/trade-stats.utils';

/** Shared, scoped dashboard projections consumed independently by widget components. */
@Injectable()
export class DashboardDataService {
    private readonly trades = inject(TradeService);
    private readonly filters = inject(FilterService);
    private readonly accounts = inject(AccountService);

    readonly filteredTrades = computed(() => this.filters.filterTrades(this.trades.trades()));
    readonly calendarTrades = computed(() => this.filters.filterTradesIgnoreDateRange(this.trades.trades()));
    readonly stats = computed(() => this.trades.calculateStats(this.filteredTrades()));
    readonly recentTrades = computed(() => [...this.filteredTrades()]
        .sort((left, right) => new Date(right.entryDate).getTime() - new Date(left.entryDate).getTime())
        .slice(0, 5));

    equityCurve(grouping: EquityCurveGrouping) {
        const openingBalance = this.accounts.openingBalance();
        const rangeStart = this.filters.filters().dateRange.start;
        const anchor = rangeStart
            ? computeWindowedBalance(
                openingBalance,
                this.calendarTrades(),
                tradeSessionDateStr(rangeStart.toISOString()),
            )
            : openingBalance;
        return buildPerformanceEquityCurve(this.filteredTrades(), anchor, grouping);
    }
}
