import { describe, expect, it } from 'vitest';
import { parseTradovateSocketFrame, TradovateLiveAccumulator } from './tradovate-live.utils';

const date = { year: 2026, month: 8, day: 4 };

describe('Tradovate live stream utilities', () => {
    it('parses valid transport frames and safely rejects malformed frames', () => {
        expect(parseTradovateSocketFrame('o')).toEqual({ type: 'open' });
        expect(parseTradovateSocketFrame('h')).toEqual({ type: 'heartbeat' });
        expect(parseTradovateSocketFrame('c[3000,"closed"]')).toEqual({ type: 'close' });
        expect(parseTradovateSocketFrame('a[{"i":1,"s":200}]')).toEqual({
            type: 'messages', messages: [{ i: 1, s: 200 }],
        });
        expect(parseTradovateSocketFrame('a{bad json')).toEqual({ type: 'invalid' });
        expect(parseTradovateSocketFrame(new Blob())).toEqual({ type: 'invalid' });
    });

    it('treats initial positions as a baseline and projects cash balance P&L', () => {
        const live = new TradovateLiveAccumulator('connection-1', [10], () => 100);
        const update = live.replaceFromInitial({
            accounts: [{ id: 10 }],
            cashBalances: [{ id: 1, accountId: 10, amount: 50_400, realizedPnL: 400, weekRealizedPnL: 900, tradeDate: date }],
            positions: [{ id: 7, accountId: 10, netPos: 2, tradeDate: date }],
        });

        expect(update.completedAccountIds).toEqual([]);
        expect(update.balances).toEqual([expect.objectContaining({ accountId: 10, amount: 50_400 })]);
        expect(live.snapshot()).toEqual([expect.objectContaining({
            accountId: 10,
            tradeDate: '2026-08-04',
            dailyPnl: 400,
            weeklyPnl: 900,
            balance: 50_400,
            completedTrades: 0,
        })]);
    });

    it('counts only flat or reversal transitions, not scaling or first-seen positions', () => {
        const live = new TradovateLiveAccumulator('connection-1', [10]);
        live.replaceFromInitial({
            cashBalances: [{ accountId: 10, amount: 50_000, tradeDate: date }],
            positions: [{ id: 7, accountId: 10, netPos: 3, tradeDate: date }],
        });

        const reduced = live.applyProps({ entityType: 'position', entity: { id: 7, accountId: 10, contractId: 44, netPos: 1, netPrice: 23_100, tradeDate: date } });
        expect(reduced.changed).toBe(false);
        expect(reduced.positionEvents[0]).toEqual(expect.objectContaining({
            kind: 'reduced', direction: 'long', previousQuantity: 3, quantity: 1,
            contractId: 44, averagePrice: 23_100,
        }));

        const closed = live.applyProps({ entityType: 'position', entity: { id: 7, accountId: 10, contractId: 44, netPos: 0, tradeDate: date } });
        expect(closed.completedAccountIds).toEqual([10]);
        expect(closed.positionEvents[0]).toEqual(expect.objectContaining({
            kind: 'closed', direction: 'long', previousQuantity: 1, quantity: 0,
        }));

        const opened = live.applyProps({ entityType: 'position', entity: { id: 8, accountId: 10, contractId: 44, netPos: -1, tradeDate: date } });
        expect(opened.changed).toBe(false);
        expect(opened.positionEvents[0]).toEqual(expect.objectContaining({
            kind: 'opened', direction: 'short', previousQuantity: 0, quantity: 1,
        }));

        const reversed = live.applyProps({ entityType: 'position', entity: { id: 8, accountId: 10, contractId: 44, netPos: 2, tradeDate: date } });
        expect(reversed.completedAccountIds).toEqual([10]);
        expect(reversed.positionEvents[0]).toEqual(expect.objectContaining({
            kind: 'reversed', direction: 'long', previousQuantity: 1, quantity: 2,
        }));
        expect(live.snapshot()[0].completedTrades).toBe(2);
    });

    it('starts a fresh baseline when the broker trade date changes', () => {
        const live = new TradovateLiveAccumulator('connection-1', [10]);
        live.replaceFromInitial({
            cashBalances: [{ accountId: 10, amount: 50_000, tradeDate: date }],
            positions: [{ id: 7, accountId: 10, netPos: 1, tradeDate: date }],
        });
        live.applyProps({ entityType: 'position', entity: { id: 7, accountId: 10, netPos: 0, tradeDate: date } });
        const oldBaseline = live.snapshot()[0].baselineKey;

        live.applyProps({
            entityType: 'cashBalance',
            entity: { accountId: 10, realizedPnL: 0, weekRealizedPnL: 900, tradeDate: { year: 2026, month: 8, day: 5 } },
        });

        expect(live.snapshot()[0]).toEqual(expect.objectContaining({
            tradeDate: '2026-08-05', dailyPnl: 0, completedTrades: 0,
        }));
        expect(live.snapshot()[0].baselineKey).not.toBe(oldBaseline);
    });

    it('does not invent a zero balance when a P&L event omits amount', () => {
        const live = new TradovateLiveAccumulator('connection-1', [10]);
        const update = live.applyProps({
            entityType: 'cashBalance',
            entity: { accountId: 10, realizedPnL: 125, tradeDate: date },
        });
        expect(update.changed).toBe(true);
        expect(update.balances).toEqual([]);
        expect(live.snapshot()[0].dailyPnl).toBe(125);
    });

    it('gives each reconnect snapshot a distinct baseline identity', () => {
        const first = new TradovateLiveAccumulator('connection-1', [10], () => 1, 'stream-1');
        const second = new TradovateLiveAccumulator('connection-1', [10], () => 1, 'stream-2');
        first.replaceFromInitial({ cashBalances: [{ accountId: 10, amount: 50_000, tradeDate: date }] });
        second.replaceFromInitial({ cashBalances: [{ accountId: 10, amount: 50_000, tradeDate: date }] });
        expect(first.snapshot()[0].baselineKey).not.toBe(second.snapshot()[0].baselineKey);
    });
});
