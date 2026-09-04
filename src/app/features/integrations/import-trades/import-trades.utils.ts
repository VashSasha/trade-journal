import { Trade } from '../../../core/models/trade.model';
import { PerformanceCsvTrade } from '../../../core/utils/tradovate-performance.utils';
import { reconcileBrokerTrades } from '../../../core/utils/broker-trade-identity';

export interface ImportSplit {
    newTrades: PerformanceCsvTrade[];
    duplicates: PerformanceCsvTrade[];
    review: PerformanceCsvTrade[];
}

/**
 * Split parsed CSV trades into new vs already-journaled, using the same
 * externalId matching SyncService applies during a broker sync (including the
 * legacy no-accountId key format for trades stored before accountId prefixing).
 */
export function splitByExisting(parsed: PerformanceCsvTrade[], existing: Trade[]): ImportSplit {
    return reconcileBrokerTrades(parsed, existing);
}

/**
 * Deterministic numeric id for a manually-entered account name. Must be stable
 * so re-importing a file for the same typed name reproduces identical
 * externalIds (the dedup key embeds the accountId). Offset into the 9e9 range
 * so it can never collide with a real Tradovate account id, and consistent with
 * how historical accounts are derived from trades (numeric-string accountId).
 */
export function stableAccountIdFromName(name: string): number {
    const norm = name.trim().toLowerCase();
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < norm.length; i++) {
        h ^= norm.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 9_000_000_000 + (h % 1_000_000_000);
}
