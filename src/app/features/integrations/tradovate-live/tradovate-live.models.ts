export type TradovateLiveState =
    | 'off'
    | 'standby'
    | 'connecting'
    | 'live'
    | 'reconnecting'
    | 'needs-auth'
    | 'unavailable';

export interface TradovateLiveAccountMetric {
    connectionId: string;
    accountId: number;
    tradeDate: string | null;
    dailyPnl: number | null;
    weeklyPnl: number | null;
    balance: number | null;
    completedTrades: number;
    baselineKey: string;
    updatedAt: number;
}

export type TradovateLivePositionEventKind =
    | 'opened'
    | 'increased'
    | 'reduced'
    | 'closed'
    | 'reversed';

/**
 * Token-free position context derived from a realtime broker update. Raw
 * WebSocket payloads and credentials never leave TradovateLiveService.
 */
export interface TradovateLivePositionEvent {
    eventId: string;
    connectionId: string;
    accountId: number;
    positionId: number;
    contractId: number | null;
    tradeDate: string | null;
    kind: TradovateLivePositionEventKind;
    direction: 'long' | 'short';
    previousQuantity: number;
    quantity: number;
    averagePrice: number | null;
    observedAt: number;
}

export interface TradovateLiveConnectionStatus {
    connectionId: string;
    connectionName: string;
    state: Exclude<TradovateLiveState, 'off' | 'standby'>;
    detail?: string;
}

export interface TradovateSocketResponse {
    i?: number;
    s?: number;
    e?: string;
    d?: unknown;
}

export type TradovateSocketFrame =
    | { type: 'open' | 'heartbeat' | 'close' }
    | { type: 'messages'; messages: TradovateSocketResponse[] }
    | { type: 'invalid' };

export interface TradovateLiveBroadcastSnapshot {
    kind: 'snapshot';
    ownerId: string;
    sourceId: string;
    state: TradovateLiveState;
    metrics: TradovateLiveAccountMetric[];
    sentAt: number;
}

export interface TradovateLiveBroadcastHello {
    kind: 'hello';
    ownerId: string;
    sourceId: string;
}

export type TradovateLiveBroadcastMessage =
    | TradovateLiveBroadcastSnapshot
    | TradovateLiveBroadcastHello;
