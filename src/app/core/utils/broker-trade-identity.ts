import { Trade } from '../models/trade.model';

type BrokerTrade = Pick<Trade, 'accountId' | 'symbol' | 'direction' | 'quantity' |
    'entryDate' | 'exitDate' | 'entryPrice' | 'exitPrice' | 'pnl' | 'externalId'>;
const weakId = (id?: string) => !id || /\d{4}-\d{2}-\d{2}T/.test(id);
function economicKey(t: BrokerTrade): string | null {
    if (!t.accountId || !t.exitDate || t.exitPrice === undefined || t.pnl === undefined) return null;
    const entry = Date.parse(t.entryDate), exit = Date.parse(t.exitDate);
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
    return JSON.stringify([t.accountId, t.symbol, t.direction, t.quantity, entry, exit, t.entryPrice, t.exitPrice, t.pnl]);
}

/** Fill IDs are authoritative. Timestamp-only HTML IDs are NOT: an exact
 * economic match with a different ID is held for review, not silently imported
 * twice or merged into a genuinely separate trade. Never dedupe across accounts. */
export function reconcileBrokerTrades<T extends BrokerTrade>(incoming: T[], stored: Trade[]) {
    const existing = stored.filter(t => t.source === 'tradovate');
    const known = new Map(existing.filter(t => t.externalId).map(t => [`${t.accountId}:${t.externalId}`, t]));
    const seen = new Set<string>();
    const newTrades: T[] = [], duplicates: T[] = [], review: T[] = [];
    const matches = new Map<T, Trade>();
    for (const trade of incoming) {
        const id = `${trade.accountId}:${trade.externalId}`;
        const legacyId = `${trade.accountId}:tradovate_perf_${trade.symbol}_${trade.entryDate}_${trade.exitDate}`;
        const match = known.get(id) ?? known.get(legacyId);
        if (match || seen.has(id)) {
            duplicates.push(trade);
            if (match) matches.set(trade, match);
        } else {
            const key = economicKey(trade);
            const uncertain = key && [...existing, ...newTrades].some(t =>
                (weakId(t.externalId) || weakId(trade.externalId)) && economicKey(t) === key);
            (uncertain ? review : newTrades).push(trade);
        }
        seen.add(id);
    }
    return { newTrades, duplicates, review, matches };
}
