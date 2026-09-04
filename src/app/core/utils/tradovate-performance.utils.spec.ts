import { expect } from 'vitest';
import { parsePerformanceCsv, parsePerformancePnl } from './tradovate-performance.utils';

const HEADER = 'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration';

// 3 MNQU6 round-turns: a long win with a thousands-separator pnl (splits into an
// extra column on the naive comma split), a short (sold before bought), a long loss.
const THREE_ROW_CSV = [
    HEADER,
    'MNQU6,-2,0,0.25,111111,222222,2,23000.25,23331.25,$1,322.00,07/30/2026 09:18:56,07/30/2026 09:25:10,6min 14sec',
    'MNQU6,-2,0,0.25,333333,444444,1,23110.00,23140.00,$60.00,07/30/2026 10:05:00,07/30/2026 10:01:00,4min 0sec',
    'MNQU6,-2,0,0.25,555555,666666,1,23120.00,23101.00,$(38.00),07/30/2026 11:00:00,07/30/2026 11:02:30,2min 30sec'
].join('\n');

describe('parsePerformancePnl', () => {
    it('parses positive, negative (parenthesized), and thousands-separated values', () => {
        expect(parsePerformancePnl('$106.00')).toBe(106);
        expect(parsePerformancePnl('$(38.00)')).toBe(-38);
        expect(parsePerformancePnl('$1,054.00')).toBe(1054);
    });
});

describe('parsePerformanceCsv', () => {
    it('parses all rows of a 3-trade MNQU6 export', () => {
        const trades = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K');
        expect(trades).toHaveLength(3);
        expect(trades.every(t => t.symbol === 'MNQU6')).toBe(true);
        expect(trades.every(t => t.accountId === '12345')).toBe(true);
        expect(trades.every(t => t.accountName === 'Apex 50K')).toBe(true);
        expect(trades.every(t => t.status === 'closed')).toBe(true);
    });

    it('reconstructs a pnl containing a thousands separator', () => {
        const [win] = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K');
        expect(win.pnl).toBe(1322);
        expect(win.direction).toBe('long');
    });

    it('detects a short when soldTimestamp is before boughtTimestamp', () => {
        const short = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K')[1];
        expect(short.direction).toBe('short');
        // Entered on the (earlier) sell, exited on the (later) buy
        expect(short.entryPrice).toBe(23140);
        expect(short.exitPrice).toBe(23110);
        expect(new Date(short.entryDate) < new Date(short.exitDate)).toBe(true);
    });

    it('parses a parenthesized loss as negative pnl', () => {
        const loss = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K')[2];
        expect(loss.pnl).toBe(-38);
    });

    it('builds externalIds keyed on accountId + fill IDs, matching the sync format', () => {
        const trades = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K');
        expect(trades[0].externalId).toBe('tradovate_perf_12345_MNQU6_111111_222222');
        expect(trades[1].externalId).toBe('tradovate_perf_12345_MNQU6_333333_444444');
    });

    it('falls back to the composite key when fill IDs are missing', () => {
        const csv = [
            HEADER,
            'MNQU6,-2,0,0.25,,,2,23000.25,23050.25,$200.00,07/30/2026 09:18:56,07/30/2026 09:25:10,6min 14sec'
        ].join('\n');
        const [t] = parsePerformanceCsv(csv, 12345, 'Apex 50K');
        expect(t.externalId).toBe(
            `tradovate_perf_12345_MNQU6_${t.entryDate}_${t.exitDate}_${t.entryPrice}_${t.exitPrice}_${t.pnl}`
        );
    });

    it('rejects unexpected columns rather than treating a failed report as no trades', () => {
        const csv = 'foo,bar,baz\n1,2,3';
        expect(() => parsePerformanceCsv(csv, 12345, 'Apex 50K')).toThrow('Unrecognized');
    });

    it('accepts a verified header-only empty report, not an empty/error response', () => {
        expect(parsePerformanceCsv(HEADER, 12345, 'Apex 50K')).toEqual([]);
        expect(() => parsePerformanceCsv('', 12345, 'Apex 50K')).toThrow();
    });

    it('rejects a malformed row instead of silently importing a partial history', () => {
        expect(() => parsePerformanceCsv(THREE_ROW_CSV + '\nMNQU6,broken', 12345, 'Apex 50K')).toThrow('Incomplete');
    });
});
