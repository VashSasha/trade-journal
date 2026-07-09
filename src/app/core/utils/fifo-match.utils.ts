export interface FillInput {
  price: number;
  quantity: number;
}

export interface MatchResult {
  /** Realized P&L (dollars) for the contracts closed by this fill. */
  realizedPnl: number;
  /** Contracts actually closed against opposing open lots. */
  closedQuantity: number;
}

interface OpenLot {
  price: number;
  quantity: number;
}

/**
 * Stateful FIFO position matcher for a single instrument.
 *
 * Feed it opposing fills; it pairs them oldest-lot-first and reports realized
 * P&L as fills close existing exposure. A fill larger than the opposing open
 * quantity closes what it can and opens a new lot on the other side.
 *
 * `pointValue` is the dollar value of one full point for the instrument and is
 * applied as:
 *   realizedPnl = (exitPrice - entryPrice) * closedQuantity * pointValue   (long)
 *   realizedPnl = (entryPrice - exitPrice) * closedQuantity * pointValue   (short)
 *
 * Defaults to 20 (NQ). Set per instrument when constructing — e.g. MNQ = 2,
 * ES = 50, MES = 5, MGC = 10.
 */
export class FifoMatcher {
  private readonly longLots: OpenLot[] = [];
  private readonly shortLots: OpenLot[] = [];

  constructor(private readonly pointValue: number = 20) {
  }

  /**
   * Buy fill: covers open short lots FIFO (realizing P&L), then opens/extends
   * a long position with any remaining quantity.
   */
  addBuy(fill: FillInput): MatchResult {
    let remaining = fill.quantity;
    let realizedPnl = 0;
    let closedQuantity = 0;

    while (remaining > 0 && this.shortLots.length > 0) {
      const lot = this.shortLots[0];
      const toClose = Math.min(remaining, lot.quantity);

      realizedPnl += (lot.price - fill.price) * toClose * this.pointValue;
      closedQuantity += toClose;
      remaining -= toClose;
      lot.quantity -= toClose;

      if (lot.quantity === 0) {
        this.shortLots.shift();
      }
    }

    if(remaining > 0) {
      this.longLots.push({price: fill.price, quantity: remaining});
    }

    return {realizedPnl, closedQuantity}
  }

  /**
   * Sell fill: closes open long lots FIFO (realizing P&L), then opens/extends
   * a short position with any remaining quantity.
   */
  sell(fill: FillInput): MatchResult {
    let remaining = fill.quantity;
    let realizedPnl = 0;
    let closedQuantity = 0;

    while (remaining > 0 && this.longLots.length > 0) {
      const lot = this.longLots[0];
      const toClose = Math.min(remaining, lot.quantity);

      realizedPnl += (fill.price - lot.price) * toClose * this.pointValue;
      closedQuantity += toClose;
      remaining -= toClose;
      lot.quantity -= toClose;

      if (lot.quantity === 0) {
        this.longLots.shift();
      }
    }

    if (remaining > 0) {
      this.shortLots.push({price: fill.price, quantity: remaining});
    }

    return {realizedPnl, closedQuantity};
  }

  /** Net open position: positive = net long, negative = net short, 0 = flat. */
  get openQuantity(): number {
    const long = this.longLots.reduce((n, l) => n + l.quantity, 0);
    const short = this.shortLots.reduce((n, l) => n + l.quantity, 0);
    return long - short;
  }
}
