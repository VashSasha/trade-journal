import { Trade } from '../models/trade.model';
import { inferTradeDecisions } from './trade-decisions.utils';

function execution(
    id: string,
    accountId: string | undefined,
    entrySeconds: number,
    exitSeconds: number,
    pnl: number,
    overrides: Partial<Trade> = {},
): Trade {
    const at = (seconds: number) => new Date(Date.UTC(2026, 7, 4, 14, 30, seconds)).toISOString();
    return {
        id,
        userId: 'user',
        symbol: 'MNQU6',
        assetType: 'futures',
        direction: 'long',
        entryDate: at(entrySeconds),
        exitDate: at(exitSeconds),
        entryPrice: 23_000,
        exitPrice: 23_010,
        quantity: 1,
        pnl,
        netPnl: pnl,
        source: 'tradovate',
        accountId,
        status: 'closed',
        createdAt: at(entrySeconds),
        updatedAt: at(exitSeconds),
        ...overrides,
    };
}

describe('inferTradeDecisions', () => {
    it('recognizes copied executions as one decision per entry across accounts', () => {
        const trades: Trade[] = [];
        for (let decision = 0; decision < 4; decision++) {
            for (let account = 1; account <= 5; account++) {
                trades.push(execution(
                    `${decision}-${account}`,
                    String(account),
                    decision * 300 + account,
                    decision * 300 + 120 + account,
                    decision === 3 ? -50 : 100,
                    { quantity: account === 5 ? 2 : 1 },
                ));
            }
        }

        const result = inferTradeDecisions(trades);

        expect(result.executionCount).toBe(20);
        expect(result.decisionCount).toBe(4);
        expect(result.accountCount).toBe(5);
        expect(result.mirroredDecisionCount).toBe(4);
        expect(result.mirroredExecutionCount).toBe(20);
        expect(result.winners).toBe(3);
        expect(result.losers).toBe(1);
        expect(result.winRate).toBe(75);
        expect(result.decisions[0]).toMatchObject({
            mirrored: true,
            totalPnl: 500,
            averagePnl: 100,
            minQuantity: 1,
            maxQuantity: 2,
        });
    });

    it('never merges rapid executions from the same account', () => {
        const result = inferTradeDecisions([
            execution('one', 'account-a', 0, 60, 40),
            execution('two', 'account-a', 3, 63, 50),
        ]);

        expect(result.executionCount).toBe(2);
        expect(result.decisionCount).toBe(2);
        expect(result.mirroredDecisionCount).toBe(0);
    });

    it('does not merge different accounts when timing or the trade shape disagrees', () => {
        const result = inferTradeDecisions([
            execution('base', 'account-a', 0, 60, 40),
            execution('late-entry', 'account-b', 20, 80, 40),
            execution('late-exit', 'account-c', 1, 95, 40),
            execution('short', 'account-d', 1, 61, 40, { direction: 'short' }),
            execution('other-symbol', 'account-e', 1, 61, 40, { symbol: 'MESU6' }),
        ]);

        expect(result.decisionCount).toBe(5);
        expect(result.mirroredDecisionCount).toBe(0);
    });

    it('keeps executions without an account identity independent', () => {
        const result = inferTradeDecisions([
            execution('manual-one', undefined, 0, 60, 40),
            execution('manual-two', undefined, 0, 60, 40),
        ]);

        expect(result.decisionCount).toBe(2);
        expect(result.accountCount).toBe(1);
        expect(result.mirroredDecisionCount).toBe(0);
    });
});
