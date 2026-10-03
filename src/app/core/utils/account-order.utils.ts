/** Broker creation date when available; descending ID is a stable best-effort
 * fallback, not a claim that an account's last sync time is its creation date. */
export function newestAccountsFirst<T extends { id: number; timestamp?: string }>(accounts: T[]): T[] {
    return [...accounts].sort((a, b) =>
        (Date.parse(b.timestamp ?? '') || 0) - (Date.parse(a.timestamp ?? '') || 0) || b.id - a.id);
}
