export interface BrokerAccountTarget {
    connectionId: string;
    accountId: number;
}

export interface BrokerAccountRequest extends BrokerAccountTarget {
    fromDate?: Date | null;
    toDate?: Date;
}

export interface AccountSyncResult extends BrokerAccountTarget {
    accountName: string;
    state: 'fetching' | 'saving' | 'synced' | 'failed' | 'cancelled';
    message: string;
    imported: number;
    fromDate: string | null;
    toDate: string;
}

export interface BrokerSyncCheckpoint {
    connection_id: string;
    account_id: number;
    synced_at: string;
    range_from: string | null;
    range_to: string;
}

export function brokerAccountKey(target: BrokerAccountTarget): string {
    return JSON.stringify([target.connectionId, target.accountId]);
}

/** Device-local retry intent contains no credentials and is never a success receipt. */
export function parsePendingSync(value: unknown): AccountSyncResult[] {
    if (!Array.isArray(value)) return [];
    return value.filter((r): r is AccountSyncResult => !!r && typeof r === 'object'
        && typeof r.connectionId === 'string' && r.connectionId.length > 0 && r.connectionId.length <= 200
        && Number.isSafeInteger(r.accountId) && r.accountId > 0
        && typeof r.accountName === 'string' && r.accountName.length <= 200
        && (r.fromDate === null || (typeof r.fromDate === 'string' && Number.isFinite(Date.parse(r.fromDate))))
        && typeof r.toDate === 'string' && Number.isFinite(Date.parse(r.toDate))
        && (r.fromDate === null || Date.parse(r.fromDate) <= Date.parse(r.toDate)))
        .map(r => ({ connectionId: r.connectionId, accountId: r.accountId, accountName: r.accountName,
            fromDate: r.fromDate, toDate: r.toDate, state: 'failed', imported: 0,
            message: 'Previous sync did not finish. Retry this account; saved trades are kept.' }));
}
