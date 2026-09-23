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
    return reportNumber(raw, true);
}

/** Strict decimal parsing: never silently turn missing/malformed broker data into zero. */
function reportNumber(raw: string, money = false): number {
    let value = raw.trim().replace(/\u2212/g, '-');
    if (money) value = value.replace(/^([+-])\$/, '$1').replace(/^\$/, '').trim();
    const negative = money && value.startsWith('(') && value.endsWith(')');
    if (negative) value = value.slice(1, -1).trim().replace(/^\$/, '').trim();
    if (negative && /^[+-]/.test(value)) return NaN;
    // Commas must be thousands groups, not arbitrary separators or decimal commas.
    if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(value)) return NaN;
    const number = Number(value.replace(/,/g, ''));
    return negative ? -number : number;
}

function invalidField(row: number, field: string): Error {
    // Deliberately exclude the raw value/report (may contain private broker data).
    return new Error(`Invalid Performance report row ${row}: invalid or missing ${field}.`);
}

/** CSV quoting, escaped quotes, CRLF and BOM; line numbers refer to the original report. */
function performanceRows(csv: string): { cells: string[]; line: number }[] {
    const rows: { cells: string[]; line: number }[] = [];
    let cells: string[] = [], cell = '', quoted = false, closedQuote = false;
    let line = 1, rowLine = 1;
    const finishCell = () => { cells.push(cell.trim()); cell = ''; closedQuote = false; };
    const finishRow = () => {
        finishCell();
        if (cells.length > 1 || cells.some(value => value !== '')) rows.push({ cells, line: rowLine });
        cells = [];
    };
    const source = csv.replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (quoted) {
            if (char === '"') {
                if (source[i + 1] === '"') { cell += '"'; i++; }
                else { quoted = false; closedQuote = true; }
            } else {
                cell += char;
                if (char === '\n') line++;
            }
        } else if (char === ',') {
            finishCell();
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[i + 1] === '\n') i++;
            finishRow();
            rowLine = ++line;
        } else if (char === '"') {
            if (cell.trim() || closedQuote) throw invalidField(rowLine, `CSV quoting in column ${cells.length + 1}`);
            cell = ''; quoted = true;
        } else if (closedQuote) {
            if (!/\s/.test(char)) throw invalidField(rowLine, `CSV quoting in column ${cells.length + 1}`);
        } else {
            cell += char;
        }
    }
    if (quoted) throw invalidField(rowLine, `CSV quoting in column ${cells.length + 1}`);
    finishRow();
    return rows;
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
        const rows = performanceRows(csv);
        if (!rows.length) throw new Error('Empty Performance report response.');

        const header = rows[0].cells;
        // Positional parsing is safe only for this known broker layout.
        const required = ['symbol', '_priceFormat', '_priceFormatType', '_tickSize', 'buyFillId', 'sellFillId', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp', 'duration'];
        if (header.length !== required.length || !required.every((c, i) => header[i] === c)) {
            if (isDevMode()) { console.warn('[tradovate-performance] Performance CSV: unexpected columns', header); }
            throw new Error('Unrecognized Performance report format. Sync was not completed.');
        }

        const trades: PerformanceCsvTrade[] = [];
        for (const { cells, line } of rows.slice(1)) {
            if (cells.length < 13) throw new Error(`Incomplete Performance report row ${line}: expected 13 columns.`);
            // Older Tradovate exports leave thousands-separated P&L unquoted.
            // Recover ONLY that known column; strict number validation below
            // rejects other extra/misaligned fields instead of guessing values.
            const parts = cells.length === 13 ? cells : [
                ...cells.slice(0, 9), cells.slice(9, -3).join(','), ...cells.slice(-3)
            ];

            const symbol      = parts[0].trim();
            const tickSize    = parts[3] ? reportNumber(parts[3]) : 0;
            const buyFillId   = parts[4].trim();
            const sellFillId  = parts[5].trim();
            const quantity    = reportNumber(parts[6]);
            const buyPrice    = reportNumber(parts[7]);
            const sellPrice   = reportNumber(parts[8]);
            const boughtStr   = parts[10];
            const soldStr     = parts[11];
            const pnl         = parsePerformancePnl(parts[9]);

            if (!symbol) throw invalidField(line, 'symbol');
            for (const [field, value] of Object.entries({ qty: quantity, buyPrice, sellPrice, pnl, _tickSize: tickSize })) {
                if (!Number.isFinite(value) || (field === 'qty' && value <= 0) || (field === '_tickSize' && value < 0)) {
                    throw invalidField(line, field);
                }
            }

            const buyTime  = new Date(boughtStr);
            const sellTime = new Date(soldStr);
            if (!boughtStr || isNaN(buyTime.getTime())) throw invalidField(line, 'boughtTimestamp');
            if (!soldStr || isNaN(sellTime.getTime())) throw invalidField(line, 'soldTimestamp');

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
        throw err;
    }
}
