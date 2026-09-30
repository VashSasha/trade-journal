import { describe, expect, it } from 'vitest';
import { Trade } from '../../../core/models/trade.model';
import { tradeSessionDateStr } from '../../../core/utils/market-holidays';
import { captureChatContext } from './coach-chat.model';

const at = new Date(2026, 8, 28, 10).toISOString();
const day = tradeSessionDateStr(at);
function trade(id: string, accountId: string, overrides: Partial<Trade> = {}): Trade {
    return { id, userId: 'owner', accountId, symbol: 'MNQ', assetType: 'futures', direction: 'long', quantity: 1,
        entryDate: at, exitDate: at, entryPrice: 100, exitPrice: 110, pnl: 20, netPnl: 18, status: 'closed', source: 'tradovate',
        createdAt: at, updatedAt: at, ...overrides };
}
describe('typed Coach captured context', () => {
    it('counts copied executions separately from estimated decisions without exposing raw trades', () => {
        const trades = Array.from({ length: 5 }, (_, i) => trade(String(i), String(i + 1)));
        const result = captureChatContext(trades, 'owner', day, null, true);
        expect(result.summary).toMatchObject({ tradeCount: 5, decisionCount: 1, accountCount: 5, netPnl: 90, maxContracts: 1 });
        expect(JSON.stringify(result)).not.toContain('MNQ');
    });
    it('scopes to owner, selected accounts, closed trades and the trading day', () => {
        const trades = [trade('1', 'a'), trade('2', 'b'), trade('3', 'a', { userId: 'other' }),
            trade('4', 'a', { status: 'open' }), trade('5', 'a', { exitDate: new Date(2026, 8, 27, 10).toISOString() })];
        const accounts = ['a'];
        const context = captureChatContext(trades, 'owner', day, accounts, true);
        accounts.push('b');
        expect(context.summary?.tradeCount).toBe(1);
        expect(context.accountIds).toEqual(['a']);
        expect(captureChatContext(trades, 'owner', day, [], true).summary).toBeNull();
    });
    it('does not infer zero trades from missing or not-yet-loaded data', () => {
        expect(captureChatContext([trade('1', 'a')], 'owner', day, null, false)).toMatchObject({ dataReady: false, summary: null });
        expect(captureChatContext([], 'owner', day, null, true).summary).toBeNull();
    });
    it('uses the same overnight day convention as the journal', () => {
        const overnight = new Date(2026, 8, 28, 19).toISOString();
        expect(captureChatContext([trade('1', 'a', { exitDate: overnight })], 'owner', '2026-09-29', null, true).summary?.tradeCount).toBe(1);
    });
});
