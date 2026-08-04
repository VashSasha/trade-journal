import { isDevMode } from '@angular/core';

/**
 * One row of a Tradovate Performance report (CSV form) parsed into the shape
 * SyncService imports. Both the API sync (TradovateService.getPerformanceTrades)
 * and the manual CSV import feed trades through this exact parser so externalIds
 * and dedup behave identically.
 */
export interface PerformanceCsvTrade {
    symbol: string;
    assetType: 'futures';
    direction: 'long' | 'short';
    quantity: number;
    entryDate: string;
    exitDate: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    fees: number | undefined;
    tickSize: number;
    buyFillId: string;
    sellFillId: string;
    status: 'closed';
    accountId: string;
    accountName: string;
    externalId: string;
}

/**
 * Parse a P&L string from the Performance report.
 * "$(38.00)" → -38  |  "$106.00" → 106  |  "$1,054.00" → 1054
 */
export function parsePerformancePnl(raw: string): number {
    const isNegative = raw.includes('(');
    const value = parseFloat(raw.replace(/[$(),\s]/g, '')) || 0;
    return isNegative ? -value : value;
}

/**
 * Parse the CSV form of the Performance report (representationType='csv').
 * Columns: symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,
 *          qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
 *
 * Each row is a completed, already-matched round-turn trade — the same data as the
 * Flex.html "Trades" table, but with stable fill IDs and no DOM walking. Note the CSV
 * form does NOT include the summary block (Gross P/L / fees / Total P/L) that the HTML
 * template carries; fees are resolved downstream (commission fallback in SyncService
 * and the manual import).
 */
export function parsePerformanceCsv(csv: string, accountId: number, accountName: string): PerformanceCsvTrade[] {
    try {
        const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) return [];

        const header = lines[0].split(',').map(h => h.trim());
        // Guard against format drift — bail to empty if the columns we rely on are gone.
        const required = ['symbol', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp'];
        if (!required.every(c => header.includes(c))) {
            if (isDevMode()) { console.warn('[tradovate-performance] Performance CSV: unexpected columns', header); }
            return [];
        }

        const trades: PerformanceCsvTrade[] = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length < 13) continue;

            // Leading columns and the trailing 3 (timestamps + duration) are comma-free.
            // pnl sits in the middle and may carry a thousands separator (e.g. $1,322.00),
            // so reconstruct it from everything between sellPrice and boughtTimestamp.
            const symbol      = parts[0].trim();
            const tickSize    = parseFloat(parts[3]) || 0;
            const buyFillId   = parts[4].trim();
            const sellFillId  = parts[5].trim();
            const quantity    = parseFloat(parts[6]) || 0;
            const buyPrice    = parseFloat(parts[7]) || 0;
            const sellPrice   = parseFloat(parts[8]) || 0;
            const soldStr     = parts[parts.length - 2].trim();
            const boughtStr   = parts[parts.length - 3].trim();
            const pnl         = parsePerformancePnl(parts.slice(9, parts.length - 3).join('').trim());

            if (!symbol || !quantity || !boughtStr || !soldStr) continue;

            const buyTime  = new Date(boughtStr);
            const sellTime = new Date(soldStr);
            if (isNaN(buyTime.getTime()) || isNaN(sellTime.getTime())) continue;

            // Sell before buy → SHORT (sold to enter, bought to cover).
            const isShort    = sellTime < buyTime;
            const entryDate  = (isShort ? sellTime : buyTime).toISOString();
            const exitDate   = (isShort ? buyTime  : sellTime).toISOString();
            const entryPrice = isShort ? sellPrice : buyPrice;
            const exitPrice  = isShort ? buyPrice  : sellPrice;
            const pnlPercent = entryPrice
                ? ((isShort ? entryPrice - exitPrice : exitPrice - entryPrice) / entryPrice) * 100
                : 0;

            trades.push({
                symbol,
                assetType: 'futures',
                direction: isShort ? 'short' : 'long',
                quantity,
                entryDate,
                exitDate,
                entryPrice,
                exitPrice,
                pnl,
                pnlPercent,
                fees: undefined,
                tickSize,
                buyFillId,
                sellFillId,
                status: 'closed',
                accountId: String(accountId),
                accountName,
                // Dedup key MUST distinguish trades that share symbol + entry/exit times
                // but are genuinely separate fills (e.g. two scalps closed in the same
                // second at different prices). buyFillId/sellFillId are globally unique
                // per fill, so they key the trade exactly. Fall back to a price+pnl
                // composite only if a CSV ever arrives without fill IDs.
                externalId: (buyFillId && sellFillId)
                    ? `tradovate_perf_${accountId}_${symbol}_${buyFillId}_${sellFillId}`
                    : `tradovate_perf_${accountId}_${symbol}_${entryDate}_${exitDate}_${entryPrice}_${exitPrice}_${pnl}`
            });
        }

        if (isDevMode()) { console.log(`[tradovate-performance] Performance CSV parser extracted ${trades.length} trades`); }
        return trades;
    } catch (err) {
        console.error('[tradovate-performance] Performance CSV parsing failed:', err);
        return [];
    }
}