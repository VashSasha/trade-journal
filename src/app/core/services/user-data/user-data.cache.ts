/**
 * localStorage cache of the signed-in user's cloud data.
 *
 * Two distinct key families live side by side:
 * - CACHE_KEYS: mirror of Supabase rows, owned by whoever `owner` says.
 *   Cleared on sign-out so the next user on this machine sees nothing.
 * - LEGACY_KEYS: the pre-backend app's storage. Read exactly once by the
 *   one-time import and never written again. Left untouched on sign-out
 *   until the import has succeeded.
 */

export const CACHE_KEYS = {
    owner: 'tj_cache_owner',
    trades: 'tj_cache_trades',
    notes: 'tj_cache_journal_notes',
    rules: 'tj_cache_journal_rules',
    templates: 'tj_cache_journal_templates',
    settings: 'tj_cache_settings',
    queue: 'tj_cache_pending_writes'
} as const;

export const LEGACY_KEYS = {
    trades: 'trade_journal_trades',
    notes: 'daily_journal_notes',
    rules: 'journal_custom_rules',
    templates: 'journal_templates',
    startingBalance: 'account_starting_balance',
    commission: 'account_commission_per_contract'
} as const;

export function readCache<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
}

export function writeCache(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota exceeded — the cache is best-effort; Supabase stays authoritative.
    }
}

export function clearUserCache(): void {
    Object.values(CACHE_KEYS).forEach(key => localStorage.removeItem(key));
}

export function hasLegacyData(): boolean {
    return Object.values(LEGACY_KEYS).some(key => localStorage.getItem(key) !== null);
}

export function clearLegacyData(): void {
    Object.values(LEGACY_KEYS).forEach(key => localStorage.removeItem(key));
}
