import { FilterService } from './filter.service';
import { Trade } from '../models/trade.model';

describe('explicit account selection', () => {
    const trades = [{ id: 'live', accountId: '1' }, { id: 'historical', accountId: '2' },
        { id: 'manual' }] as Trade[];
    it('uses identical accounts for dated and undated views', () => {
        const filter = new FilterService();
        filter.updateAccounts(['2']);
        expect(filter.filterTrades(trades).map(t => t.id)).toEqual(['historical']);
        expect(filter.filterTradesIgnoreDateRange(trades).map(t => t.id)).toEqual(['historical']);
    });
    it('deselect all means none, not all', () => {
        const filter = new FilterService();
        filter.updateAccounts([]);
        expect(filter.filterTrades(trades)).toEqual([]);
        expect(filter.filterTradesIgnoreDateRange(trades)).toEqual([]);
    });
    it('selects manual trades explicitly and preserves selection on filter reset', () => {
        const filter = new FilterService();
        filter.updateAccounts(['0']); filter.reset();
        expect(filter.filterTrades(trades).map(t => t.id)).toEqual(['manual']);
    });
});
