import { expect } from 'vitest';
import { Trade } from '../../../core/models/trade.model';
import { parsePerformanceCsv, PerformanceCsvTrade } from '../../../core/utils/tradovate-performance.utils';
import { splitByExisting, stableAccountIdFromName } from './import-trades.utils';

const HEADER = 'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration';

const THREE_ROW_CSV = [
    HEADER,
    'MNQU6,-2,0,0.25,111111,222222,2,23000.25,23331.25,$1,322.00,07/30/2026 09:18:56,07/30/2026 09:25:10,6min 14sec',
    'MNQU6,-2,0,0.25,333333,444444,1,23110.00,23140.00,$60.00,07/30/2026 10:05:00,07/30/2026 10:01:00,4min 0sec',
    'MNQU6,-2,0,0.25,555555,666666,1,23120.00,23101.00,$(38.00),07/30/2026 11:00:00,07/30/2026 11:02:30,2min 30sec'
].join('\n');

/** A stored trade as it would look after going through createTrade (sync or import). */
function asStoredTrade(t: PerformanceCsvTrade, overrides: Partial<Trade> = {}): Trade {
    return {
        ...t,
        id: `id_${t.externalId}`,
        userId: 'user-1',
        source: 'tradovate',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
        ...overrides
    };
}

describe('splitByExisting', () => {
    const parsed = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K');

    it('marks every trade new when the journal is empty (first import)', () => {
        const { newTrades, duplicates } = splitByExisting(parsed, []);
        expect(newTrades).toHaveLength(3);
        expect(duplicates).toHaveLength(0);
    });

    it('marks every trade duplicate on re-import of the same file', () => {
        const existing = parsed.map(t => asStoredTrade(t));
        const { newTrades, duplicates } = splitByExisting(parsed, existing);
        expect(newTrades).toHaveLength(0);
        expect(duplicates).toHaveLength(3);
    });

    it('marks trades duplicate when a prior sync of the same account stored them', () => {
        // A sync runs the identical parser with the same accountId, so stored
        // externalIds match the CSV import exactly.
        const syncedTrades = parsePerformanceCsv(THREE_ROW_CSV, 12345, 'Apex 50K')
            .map(t => asStoredTrade(t));
        const { newTrades, duplicates } = splitByExisting(parsed, syncedTrades);
        expect(newTrades).toHaveLength(0);
        expect(duplicates).toHaveLength(3);
    });

    it('does NOT dedupe against the same fills imported under a different account', () => {
        const otherAccount = parsePerformanceCsv(THREE_ROW_CSV, 99999, 'Other')
            .map(t => asStoredTrade(t));
        const { newTrades } = splitByExisting(parsed, otherAccount);
        expect(newTrades).toHaveLength(3);
    });

    it('matches legacy-format externalIds (no accountId prefix) for the same account', () => {
        const legacy = asStoredTrade(parsed[0], {
            externalId: `tradovate_perf_${parsed[0].symbol}_${parsed[0].entryDate}_${parsed[0].exitDate}`
        });
        const { newTrades, duplicates } = splitByExisting(parsed, [legacy]);
        expect(duplicates).toHaveLength(1);
        expect(newTrades).toHaveLength(2);
    });

    it('ignores manual trades when matching', () => {
        const manual = asStoredTrade(parsed[0], { source: 'manual' });
        const { newTrades } = splitByExisting(parsed, [manual]);
        expect(newTrades).toHaveLength(3);
    });

    it('holds a CSV match to an older HTML import for review, never imports it twice', () => {
        const t = parsed[0];
        const html = asStoredTrade(t, { externalId: `tradovate_perf_${t.accountId}_${t.symbol}_${t.entryDate}_${t.exitDate}_${t.entryPrice}_${t.exitPrice}_${t.pnl}` });
        const result = splitByExisting([t], [html]);
        expect(result.newTrades).toHaveLength(0);
        expect(result.review).toHaveLength(1);
    });
    it('keeps distinct stable fills even when every economic value is identical', () => {
        const differentFill = { ...parsed[0], externalId: 'tradovate_perf_12345_MNQU6_999_888' };
        expect(splitByExisting([differentFill], [asStoredTrade(parsed[0])]).newTrades).toHaveLength(1);
    });
    it('deduplicates repeated rows within the incoming file', () => {
        const result = splitByExisting([parsed[0], parsed[0]], []);
        expect(result.newTrades).toHaveLength(1);
        expect(result.duplicates).toHaveLength(1);
    });
});

describe('stableAccountIdFromName', () => {
    it('is deterministic and normalizes case/whitespace', () => {
        expect(stableAccountIdFromName('Apex Eval 50K')).toBe(stableAccountIdFromName('Apex Eval 50K'));
        expect(stableAccountIdFromName('  apex eval 50k  ')).toBe(stableAccountIdFromName('Apex Eval 50K'));
    });

    it('produces distinct ids for distinct names, outside the real Tradovate id range', () => {
        const a = stableAccountIdFromName('Apex Eval 50K');
        const b = stableAccountIdFromName('TPT 100K');
        expect(a).not.toBe(b);
        expect(a).toBeGreaterThanOrEqual(9_000_000_000);
        expect(b).toBeGreaterThanOrEqual(9_000_000_000);
    });
});
