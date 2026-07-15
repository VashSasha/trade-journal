import { FifoMatcher } from './fifo-match.utils';
import { expect } from 'vitest';

describe('FifoMatcher', () => {
    let matcher: FifoMatcher;

    beforeEach(() => {
        // pointValue 20 = NQ ($20/pt). Construct with a different value to test
        // other instruments (MNQ = 2, ES = 50, …).
        matcher = new FifoMatcher(20);
    });

    it('should close a full lot and return correct P&L', () => {
        matcher.addBuy({ price: 21000, quantity: 2 });
        const result = matcher.sell({ price: 21100, quantity: 2 });
        expect(result.realizedPnl).toBe(4000); // 100pts × 2 × $20
        expect(result.closedQuantity).toBe(2);
        expect(matcher.openQuantity).toBe(0);
    });

    // --- Direction -----------------------------------------------------------
    it.todo('realizes a loss when a long is closed below entry');
    it('realizes a loss when a long is closed below entry', () => {
      matcher.addBuy({ price: 21100, quantity: 2 });
      const result = matcher.sell({price: 21000, quantity: 2 });

      expect(result.closedQuantity).toBe(2);
      expect(result.realizedPnl).toBe(-4000);
      expect(matcher.openQuantity).toBe(0);
    })

    it.todo('matches a short (sell to open, buy to cover) and realizes PnL');

    // --- FIFO ordering -------------------------------------------------------
    it.todo('closes the OLDEST long lot first when lots have different prices');
    it.todo('reports zero realized PnL for the opening fill');

    // --- Partial fills / scaling --------------------------------------------
    it('closes part of a lot, leaving the remainder open', () => {
      matcher.addBuy({ price: 21000, quantity: 3 });
      const result = matcher.sell({ price: 21100, quantity: 2 });
      expect(result.realizedPnl).toBe(4000);
      expect(result.closedQuantity).toBe(2)
      expect(matcher.openQuantity).toBe(1);
    })

    it('closes across multiple lots in one sell, blending FIFO prices', () => {
      matcher.addBuy({ price: 21000, quantity: 2 });
      matcher.addBuy({ price: 21000, quantity: 3 });
      const result = matcher.sell({ price: 21100, quantity: 4 });

      expect(result.realizedPnl).toBe(8000);
      expect(result.closedQuantity).toBe(4);
      expect(matcher.openQuantity).toBe(1);
    })

    it('flips position when a sell exceeds the open long (closes then opens short)', () => {
      matcher.addBuy({ price: 21000, quantity: 2 });
      const result = matcher.sell({ price: 21100, quantity: 3 });

      expect(result.realizedPnl).toBe(4000);
      expect(result.closedQuantity).toBe(2);
      expect(matcher.openQuantity).toBe(-1);
    })

    // --- Position accounting -------------------------------------------------
    it.todo('tracks openQuantity as fills are added and closed');
    it.todo('reports closedQuantity separately from realizedPnl');

    // --- Instrument ----------------------------------------------------------
    it.todo('applies a different pointValue (e.g. MNQ = 2) to realized PnL');
});
