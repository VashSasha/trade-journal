import { DOCUMENT } from '@angular/common';
import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    isDevMode,
    signal,
    untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { AccountService } from '../../../core/services/account.service';
import { SyncService } from '../../../core/services/sync.service';
import {
    TradovateConnection,
    TradovateService,
} from '../../../core/services/tradovate.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import {
    TradovateLiveAccountMetric,
    TradovateLiveBroadcastMessage,
    TradovateLiveConnectionStatus,
    TradovateLivePositionEvent,
    TradovateLiveState,
    TradovateSocketResponse,
} from './tradovate-live.models';
import {
    parseTradovateSocketFrame,
    TradovateLiveAccumulator,
    TradovateLiveUpdate,
} from './tradovate-live.utils';

const HEARTBEAT_MS = 2_500;
const WATCHDOG_MS = 5_000;
const STALE_CONNECTION_MS = 20_000;
const LEADER_RETRY_MS = 5_000;
const RECONCILE_DEBOUNCE_MS = 30_000;
const RECONCILE_COOLDOWN_MS = 5 * 60_000;
const CHANNEL_PREFIX = 'nvzn-tradovate-live-v1:';
const LOCK_PREFIX = 'nvzn-tradovate-live-v1:';

interface ManagedConnection {
    ownerId: string;
    connectionId: string;
    connectionName: string;
    signature: string;
    accumulator: TradovateLiveAccumulator;
    socket: WebSocket | null;
    generation: number;
    reconnectAttempts: number;
    nextRequestId: number;
    authRequestId: number | null;
    syncRequestId: number | null;
    syncBody: {
        splitResponses: false;
        accounts: number[];
        entityTypes: ['cashBalance', 'position'];
    } | null;
    synced: boolean;
    intentionalClose: boolean;
    lastMessageAt: number;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    watchdogTimer: ReturnType<typeof setInterval> | null;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Owns the tab-open Tradovate user-data stream. One browser tab becomes the
 * leader via Web Locks; followers receive normalized, token-free snapshots via
 * BroadcastChannel. Raw broker events are never persisted as trades.
 */
@Injectable({ providedIn: 'root' })
export class TradovateLiveService {
    private readonly document = inject(DOCUMENT);
    private readonly view = this.document.defaultView;
    private readonly tradovate = inject(TradovateService);
    private readonly account = inject(AccountService);
    private readonly sync = inject(SyncService);
    private readonly session = inject(UserSessionService);
    private readonly access = inject(AccessPolicyService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly requesters = signal<ReadonlySet<string>>(new Set());
    readonly state = signal<TradovateLiveState>('off');
    readonly metrics = signal<TradovateLiveAccountMetric[]>([]);
    /** Recent leader-tab events consumed by realtime coaching. Never persisted. */
    readonly positionEvents = signal<readonly TradovateLivePositionEvent[]>([]);
    readonly connectionStatuses = signal<TradovateLiveConnectionStatus[]>([]);
    readonly statusLabel = computed(() => {
        switch (this.state()) {
            case 'live': return 'Live';
            case 'standby': return 'Live in another tab';
            case 'connecting': return 'Connecting';
            case 'reconnecting': return 'Reconnecting';
            case 'needs-auth': return 'Reconnect broker';
            case 'unavailable': return 'Unavailable';
            default: return 'Off';
        }
    });
    readonly statusDetail = computed(() => {
        const connectionDetail = this.connectionStatuses().find(status => status.detail)?.detail;
        if (connectionDetail && (this.state() === 'unavailable' || this.state() === 'needs-auth')) {
            return connectionDetail;
        }
        switch (this.state()) {
            case 'live': return 'Broker-reported P&L and completed positions are updating live.';
            case 'standby': return 'Another NVZN tab owns the broker stream; this tab receives its live updates.';
            case 'connecting': return 'Connecting securely to your active Tradovate account.';
            case 'reconnecting': return 'The broker stream paused. NVZN is reconnecting automatically.';
            case 'needs-auth': return 'Reconnect Tradovate in Integrations to restore live monitoring.';
            case 'unavailable': return 'Live monitoring needs an active Tradovate account.';
            default: return 'Enable a guardrail to start live monitoring while NVZN is open.';
        }
    });

    private desiredOwner: string | null = null;
    private desiredConnections: TradovateConnection[] = [];
    private desiredSignature = '';
    private enabled = false;
    private pagePaused = false;
    private leader = false;
    private leadershipPending = false;
    private leadershipGeneration = 0;
    private releaseLeadership: (() => void) | null = null;
    private leadershipRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    private lastReconcileAt = 0;
    private streamSequence = 0;
    private channel: BroadcastChannel | null = null;
    private channelOwner: string | null = null;
    private readonly sourceId = globalThis.crypto?.randomUUID?.()
        ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    private readonly managed = new Map<string, ManagedConnection>();

    constructor() {
        effect(() => {
            const owner = this.session.userId();
            const requested = this.requesters().size > 0;
            const allowed = this.access.canAct('sync');
            const connections = this.tradovate.connections();
            const signature = connections.map(connection => this.connectionSignature(connection)).sort().join('|');
            untracked(() => this.configure(owner, requested && allowed, connections, signature));
        });

        const online = () => this.reconnectStaleSockets();
        const visible = () => {
            if (this.document.visibilityState === 'visible') this.reconnectStaleSockets();
        };
        const pageHide = () => {
            this.pagePaused = true;
            this.releaseLeaderAndSockets();
            if (this.enabled) this.state.set('standby');
        };
        const pageShow = () => {
            this.pagePaused = false;
            if (this.enabled) this.tryLeadership();
        };
        this.view?.addEventListener('online', online);
        this.view?.addEventListener('pagehide', pageHide);
        this.view?.addEventListener('pageshow', pageShow);
        this.document.addEventListener('visibilitychange', visible);
        this.destroyRef.onDestroy(() => {
            this.view?.removeEventListener('online', online);
            this.view?.removeEventListener('pagehide', pageHide);
            this.view?.removeEventListener('pageshow', pageShow);
            this.document.removeEventListener('visibilitychange', visible);
            this.shutdown(true);
        });
    }

    /** Multiple realtime features may independently hold the stream open. */
    setRequested(requester: string, requested: boolean): void {
        this.requesters.update(current => {
            if (current.has(requester) === requested) return current;
            const next = new Set(current);
            if (requested) next.add(requester);
            else next.delete(requester);
            return next;
        });
    }

    private configure(
        owner: string | null,
        enabled: boolean,
        connections: TradovateConnection[],
        signature: string,
    ): void {
        const ownerChanged = owner !== this.desiredOwner;
        if (ownerChanged) {
            this.shutdown(false);
            this.lastReconcileAt = 0;
            this.desiredOwner = owner;
            this.ensureChannel(owner);
        }

        this.enabled = enabled;
        this.desiredConnections = connections;
        const connectionChanged = signature !== this.desiredSignature;
        this.desiredSignature = signature;

        if (!enabled || !owner) {
            this.releaseLeaderAndSockets();
            this.metrics.set([]);
            this.connectionStatuses.set([]);
            this.state.set('off');
            return;
        }
        if (connections.length === 0) {
            this.releaseLeaderAndSockets();
            this.metrics.set([]);
            this.connectionStatuses.set([]);
            this.state.set('unavailable');
            return;
        }

        if (this.pagePaused) {
            this.state.set('standby');
            return;
        }
        if (this.leader) {
            if (connectionChanged) this.reconcileSockets();
            return;
        }
        if (!this.leadershipPending) this.tryLeadership();
    }

    private tryLeadership(): void {
        if (!this.enabled || this.pagePaused || !this.desiredOwner || this.leader || this.leadershipPending) return;
        this.clearLeadershipRetry();
        const owner = this.desiredOwner;
        const generation = ++this.leadershipGeneration;
        // Without BroadcastChannel a follower could not receive normalized
        // updates, so fall back to one socket per tab instead of going silent.
        const locks = this.channel ? this.view?.navigator.locks : undefined;
        if (!locks) {
            this.becomeLeader();
            return;
        }

        this.leadershipPending = true;
        this.state.set('connecting');
        void locks.request(`${LOCK_PREFIX}${owner}`, { ifAvailable: true }, async lock => {
            this.leadershipPending = false;
            if (generation !== this.leadershipGeneration || owner !== this.desiredOwner || !this.enabled) return;
            if (!lock) {
                this.state.set('standby');
                this.sendHello();
                this.scheduleLeadershipRetry();
                return;
            }

            this.becomeLeader();
            await new Promise<void>(resolve => { this.releaseLeadership = resolve; });
            this.releaseLeadership = null;
            this.leader = false;
            this.stopSockets();
            if (this.enabled && this.desiredOwner === owner) this.scheduleLeadershipRetry();
        }).catch(() => {
            this.leadershipPending = false;
            if (this.enabled && this.desiredOwner === owner) {
                this.state.set('reconnecting');
                this.scheduleLeadershipRetry();
            }
        });
    }

    private becomeLeader(): void {
        if (!this.enabled || !this.desiredOwner) return;
        this.leader = true;
        this.state.set('connecting');
        this.reconcileSockets();
    }

    private reconcileSockets(): void {
        if (!this.leader || !this.enabled) return;
        const desiredIds = new Set(this.desiredConnections.map(connection => connection.id));
        for (const [connectionId, managed] of this.managed) {
            if (!desiredIds.has(connectionId)) this.stopManaged(managed, true);
        }

        for (const connection of this.desiredConnections) {
            const signature = this.connectionSignature(connection);
            const current = this.managed.get(connection.id);
            if (current?.signature === signature) continue;
            if (current) this.stopManaged(current, true);
            const managed = this.createManaged(connection, signature);
            this.managed.set(connection.id, managed);
            if (!connection.token) {
                this.setConnectionStatus(connection, 'needs-auth');
                continue;
            }
            void this.connect(managed);
        }
        this.publishMetrics();
        this.refreshState();
    }

    private createManaged(connection: TradovateConnection, signature: string): ManagedConnection {
        return {
            ownerId: this.desiredOwner!,
            connectionId: connection.id,
            connectionName: connection.name,
            signature,
            accumulator: new TradovateLiveAccumulator(
                connection.id,
                connection.accounts.map(account => account.id),
                Date.now,
                String(++this.streamSequence),
            ),
            socket: null,
            generation: 0,
            reconnectAttempts: 0,
            nextRequestId: 1,
            authRequestId: null,
            syncRequestId: null,
            syncBody: null,
            synced: false,
            intentionalClose: false,
            lastMessageAt: 0,
            heartbeatTimer: null,
            watchdogTimer: null,
            reconnectTimer: null,
        };
    }

    private async connect(managed: ManagedConnection): Promise<void> {
        const generation = ++managed.generation;
        managed.intentionalClose = false;
        managed.synced = false;
        managed.authRequestId = null;
        managed.syncRequestId = null;
        managed.nextRequestId = 1;
        this.setConnectionStatusById(
            managed,
            managed.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
        );

        try {
            await this.tradovate.ensureFreshToken(managed.connectionId);
            if (!this.isManagedCurrent(managed, generation)) return;
            let connection = this.tradovate.connections().find(item => item.id === managed.connectionId);
            if (!connection?.token) {
                this.setConnectionStatusById(managed, 'needs-auth');
                return;
            }

            let accounts = connection.accounts;
            if (accounts.length === 0) {
                accounts = await firstValueFrom(this.tradovate.getAccountsForConnection(connection));
                if (!this.isManagedCurrent(managed, generation)) return;
                connection = this.tradovate.connections().find(item => item.id === managed.connectionId) ?? connection;
            }
            const accountIds = [...new Set(accounts.map(account => account.id).filter(id => Number.isFinite(id) && id > 0))];
            if (accountIds.length === 0) {
                this.setConnectionStatusById(managed, 'unavailable', 'Refresh this broker connection to load its accounts.');
                return;
            }
            if (typeof WebSocket === 'undefined') {
                this.setConnectionStatusById(managed, 'unavailable', 'WebSockets are not supported in this browser.');
                return;
            }

            managed.accumulator = new TradovateLiveAccumulator(
                connection.id,
                accounts.map(account => account.id),
                Date.now,
                String(++this.streamSequence),
            );
            // Scope to this connection's accounts and request only the two
            // entity types needed by guardrails. No orders or credentials are
            // copied into application state.
            managed.syncBody = {
                splitResponses: false,
                accounts: accountIds,
                entityTypes: ['cashBalance', 'position'],
            };
            const url = connection.config.environment === 'live'
                ? 'wss://live.tradovateapi.com/v1/websocket'
                : 'wss://demo.tradovateapi.com/v1/websocket';
            const socket = new WebSocket(url);
            managed.socket = socket;
            managed.lastMessageAt = Date.now();

            socket.onmessage = event => this.onMessage(managed, generation, connection!, event.data);
            socket.onclose = () => this.onClosed(managed, generation);
            socket.onerror = () => {
                if (this.isManagedCurrent(managed, generation)) socket.close();
            };
            this.startWatchdog(managed, generation);
        } catch (error) {
            if (!this.isManagedCurrent(managed, generation)) return;
            if (this.isAuthFailure(error)) {
                this.tradovate.markConnectionExpired(managed.connectionId);
                this.setConnectionStatusById(managed, 'needs-auth');
                return;
            }
            if (isDevMode()) console.warn(`[TradovateLive] Could not connect ${managed.connectionName}.`);
            this.scheduleReconnect(managed);
        }
    }

    private onMessage(
        managed: ManagedConnection,
        generation: number,
        connection: TradovateConnection,
        raw: unknown,
    ): void {
        if (!this.isManagedCurrent(managed, generation)) return;
        managed.lastMessageAt = Date.now();
        const frame = parseTradovateSocketFrame(raw);
        if (frame.type === 'open') {
            if (managed.authRequestId === null) {
                managed.authRequestId = managed.nextRequestId++;
                managed.socket?.send(`authorize\n${managed.authRequestId}\n\n${connection.token}`);
            } else {
                managed.socket?.send('[]');
            }
            return;
        }
        if (frame.type === 'close') {
            managed.socket?.close();
            return;
        }
        if (frame.type !== 'messages') return;
        for (const message of frame.messages) this.onResponse(managed, generation, message);
    }

    private onResponse(managed: ManagedConnection, generation: number, message: TradovateSocketResponse): void {
        if (message.e === 'shutdown') {
            const reason = this.asRecord(message.d)?.['reasonCode'];
            const tokenRevoked = reason === 'ConnectionQuotaReached'
                || reason === 'DeviceQuotaReached'
                || reason === 'IPQuotaReached';
            if (tokenRevoked) {
                this.tradovate.markConnectionExpired(managed.connectionId);
                this.setConnectionStatusById(managed, 'needs-auth');
                this.closeManagedSocket(managed, true);
            } else {
                this.closeManagedSocket(managed, false);
            }
            return;
        }
        if (message.i === managed.authRequestId) {
            if (message.s === 200) {
                this.startHeartbeat(managed, generation);
                this.sendSyncRequest(managed, managed.syncBody);
            } else if (message.s && message.s >= 400) {
                if (message.s === 401 || message.s === 403) {
                    this.tradovate.markConnectionExpired(managed.connectionId);
                    this.setConnectionStatusById(managed, 'needs-auth');
                } else {
                    this.setConnectionStatusById(
                        managed,
                        'unavailable',
                        'Tradovate rejected the live connection. Your saved data is unaffected.',
                    );
                }
                this.closeManagedSocket(managed, true);
            }
            return;
        }

        if (message.i === managed.syncRequestId) {
            if (message.s === 200) {
                const data = this.asRecord(message.d);
                const ticket = typeof data?.['p-ticket'] === 'string' ? data['p-ticket'] : null;
                if (ticket) {
                    const seconds = typeof data?.['p-time'] === 'number' ? data['p-time'] : 2;
                    setTimeout(() => {
                        if (this.managed.get(managed.connectionId) !== managed || !managed.socket) return;
                        this.sendSyncRequest(managed, { ...managed.syncBody!, 'p-ticket': ticket });
                    }, Math.max(1, seconds) * 1000);
                    return;
                }
                const update = managed.accumulator.replaceFromInitial(message.d);
                const recoveredFromDisconnect = managed.reconnectAttempts > 0;
                managed.reconnectAttempts = 0;
                managed.synced = true;
                this.setConnectionStatusById(managed, 'live');
                this.applyUpdate(managed, update, false);
                // A reconnect intentionally treats the snapshot as a fresh
                // baseline. Reconcile shortly afterwards to recover any
                // completed trades that happened while the socket was down.
                if (recoveredFromDisconnect) this.scheduleTradeReconciliation();
            } else if (message.s && message.s >= 400) {
                if (message.s === 401 || message.s === 403) {
                    // Authorization already succeeded. This usually means the
                    // token lacks user-stream permission, not that it expired;
                    // retain it so regular REST/report sync keeps working.
                    this.setConnectionStatusById(
                        managed,
                        'unavailable',
                        'This Tradovate connection does not grant live-data access. Regular sync still works.',
                    );
                    this.closeManagedSocket(managed, true);
                } else {
                    this.closeManagedSocket(managed, false);
                }
            }
            return;
        }

        if (message.e === 'props' && managed.synced) {
            this.applyUpdate(managed, managed.accumulator.applyProps(message.d), true);
        }
    }

    private sendSyncRequest(managed: ManagedConnection, body: Record<string, unknown> | null): void {
        if (!managed.socket || !body) return;
        managed.syncRequestId = managed.nextRequestId++;
        managed.socket.send(`user/syncrequest\n${managed.syncRequestId}\n\n${JSON.stringify(body)}`);
    }

    private applyUpdate(managed: ManagedConnection, update: TradovateLiveUpdate, realtime: boolean): void {
        if (update.balances.length) this.account.applyLiveBalances(managed.connectionId, update.balances);
        if (update.changed) this.publishMetrics();
        if (realtime && update.positionEvents.length) {
            this.positionEvents.update(current => [
                ...current.slice(-49),
                ...update.positionEvents,
            ]);
        }
        if (realtime && update.completedAccountIds.length) this.scheduleTradeReconciliation();
    }

    private publishMetrics(): void {
        const next = [...this.managed.values()]
            .flatMap(managed => managed.synced ? managed.accumulator.snapshot() : [])
            .sort((a, b) => a.accountId - b.accountId || a.connectionId.localeCompare(b.connectionId));
        this.metrics.set(next);
        this.broadcastSnapshot();
    }

    private startHeartbeat(managed: ManagedConnection, generation: number): void {
        if (managed.heartbeatTimer) clearInterval(managed.heartbeatTimer);
        managed.heartbeatTimer = setInterval(() => {
            if (!this.isManagedCurrent(managed, generation)) return;
            if (managed.socket?.readyState === WebSocket.OPEN) managed.socket.send('[]');
        }, HEARTBEAT_MS);
    }

    private startWatchdog(managed: ManagedConnection, generation: number): void {
        this.clearManagedTimers(managed);
        managed.watchdogTimer = setInterval(() => {
            if (!this.isManagedCurrent(managed, generation)) return;
            if (Date.now() - managed.lastMessageAt > STALE_CONNECTION_MS) managed.socket?.close();
        }, WATCHDOG_MS);
    }

    private onClosed(managed: ManagedConnection, generation: number): void {
        if (!this.isManagedCurrent(managed, generation)) return;
        const wasSynced = managed.synced;
        this.clearManagedTimers(managed);
        managed.socket = null;
        managed.synced = false;
        if (wasSynced) this.publishMetrics();
        if (!managed.intentionalClose) this.scheduleReconnect(managed);
    }

    private scheduleReconnect(managed: ManagedConnection): void {
        if (!this.leader || !this.enabled || !this.desiredConnections.some(item => item.id === managed.connectionId)) return;
        this.clearManagedTimers(managed);
        managed.reconnectAttempts++;
        this.setConnectionStatusById(managed, 'reconnecting');
        const base = Math.min(30_000, 1_000 * (2 ** Math.min(managed.reconnectAttempts - 1, 5)));
        const delay = base + Math.floor(Math.random() * 500);
        managed.reconnectTimer = setTimeout(() => void this.connect(managed), delay);
    }

    private reconnectStaleSockets(): void {
        if (!this.leader || !this.enabled || this.view?.navigator.onLine === false) return;
        for (const managed of this.managed.values()) {
            if (!managed.socket || Date.now() - managed.lastMessageAt > STALE_CONNECTION_MS) {
                this.closeManagedSocket(managed, false);
                if (!managed.reconnectTimer) this.scheduleReconnect(managed);
            }
        }
    }

    private scheduleTradeReconciliation(): void {
        if (!this.leader || !this.enabled || this.desiredOwner !== this.session.userId()) return;
        if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
        const cooldownRemaining = Math.max(0, this.lastReconcileAt + RECONCILE_COOLDOWN_MS - Date.now());
        this.reconcileTimer = setTimeout(
            () => void this.reconcileTrades(),
            Math.max(RECONCILE_DEBOUNCE_MS, cooldownRemaining),
        );
    }

    private async reconcileTrades(): Promise<void> {
        this.reconcileTimer = null;
        if (!this.leader || !this.enabled || this.desiredOwner !== this.session.userId()) return;
        if (this.sync.isSyncing()) {
            this.scheduleTradeReconciliation();
            return;
        }
        this.lastReconcileAt = Date.now();
        try {
            await this.sync.syncTrades();
        } catch {
            if (isDevMode()) console.warn('[TradovateLive] Background trade reconciliation will retry after the next close.');
        }
    }

    private setConnectionStatus(
        connection: TradovateConnection,
        state: TradovateLiveConnectionStatus['state'],
        detail?: string,
    ): void {
        this.setConnectionStatusById({
            connectionId: connection.id,
            connectionName: connection.name,
        }, state, detail);
    }

    private setConnectionStatusById(
        connection: Pick<ManagedConnection, 'connectionId' | 'connectionName'>,
        state: TradovateLiveConnectionStatus['state'],
        detail?: string,
    ): void {
        this.connectionStatuses.update(statuses => [
            ...statuses.filter(status => status.connectionId !== connection.connectionId),
            { connectionId: connection.connectionId, connectionName: connection.connectionName, state, detail },
        ]);
        this.refreshState();
    }

    private refreshState(): void {
        if (!this.enabled) {
            this.state.set('off');
            return;
        }
        if (!this.leader) return;
        const statuses = this.connectionStatuses();
        if (statuses.some(status => status.state === 'live')) this.state.set('live');
        else if (statuses.some(status => status.state === 'reconnecting')) this.state.set('reconnecting');
        else if (statuses.some(status => status.state === 'connecting')) this.state.set('connecting');
        else if (statuses.some(status => status.state === 'needs-auth')) this.state.set('needs-auth');
        else this.state.set('unavailable');
        this.broadcastSnapshot();
    }

    private connectionSignature(connection: TradovateConnection): string {
        const accounts = connection.accounts
            .map(account => `${account.id}:${account.userId}:${account.active !== false}`)
            .sort()
            .join(',');
        return `${connection.id}:${connection.config.environment}:${connection.token}:${connection.tokenExpiresAt ?? ''}:${accounts}`;
    }

    private isManagedCurrent(managed: ManagedConnection, generation: number): boolean {
        return this.leader
            && this.enabled
            && managed.ownerId === this.desiredOwner
            && managed.ownerId === this.session.userId()
            && this.managed.get(managed.connectionId) === managed
            && managed.generation === generation;
    }

    private closeManagedSocket(managed: ManagedConnection, intentional: boolean): void {
        managed.intentionalClose = intentional;
        const wasSynced = managed.synced;
        managed.synced = false;
        if (managed.socket) {
            const socket = managed.socket;
            managed.socket = null;
            socket.onclose = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.close();
        }
        this.clearManagedTimers(managed);
        if (wasSynced) this.publishMetrics();
        if (!intentional) this.scheduleReconnect(managed);
    }

    private stopManaged(managed: ManagedConnection, remove: boolean): void {
        managed.generation++;
        this.closeManagedSocket(managed, true);
        if (remove) {
            this.managed.delete(managed.connectionId);
            this.connectionStatuses.update(statuses => statuses.filter(status => status.connectionId !== managed.connectionId));
        }
    }

    private clearManagedTimers(managed: ManagedConnection): void {
        if (managed.heartbeatTimer) clearInterval(managed.heartbeatTimer);
        if (managed.watchdogTimer) clearInterval(managed.watchdogTimer);
        if (managed.reconnectTimer) clearTimeout(managed.reconnectTimer);
        managed.heartbeatTimer = null;
        managed.watchdogTimer = null;
        managed.reconnectTimer = null;
    }

    private stopSockets(): void {
        for (const managed of this.managed.values()) this.stopManaged(managed, false);
        this.managed.clear();
        this.connectionStatuses.set([]);
        this.positionEvents.set([]);
        if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
        this.reconcileTimer = null;
    }

    private releaseLeaderAndSockets(): void {
        this.leadershipGeneration++;
        this.clearLeadershipRetry();
        this.releaseLeadership?.();
        this.releaseLeadership = null;
        this.leader = false;
        this.leadershipPending = false;
        this.stopSockets();
    }

    private scheduleLeadershipRetry(): void {
        if (this.leadershipRetryTimer || !this.enabled || this.pagePaused) return;
        this.leadershipRetryTimer = setTimeout(() => {
            this.leadershipRetryTimer = null;
            this.tryLeadership();
        }, LEADER_RETRY_MS);
    }

    private clearLeadershipRetry(): void {
        if (this.leadershipRetryTimer) clearTimeout(this.leadershipRetryTimer);
        this.leadershipRetryTimer = null;
    }

    private ensureChannel(owner: string | null): void {
        if (this.channelOwner === owner) return;
        this.channel?.close();
        this.channel = null;
        this.channelOwner = owner;
        if (!owner || typeof BroadcastChannel === 'undefined') return;
        try {
            this.channel = new BroadcastChannel(`${CHANNEL_PREFIX}${owner}`);
            this.channel.onmessage = event => this.onBroadcast(event.data);
        } catch {
            this.channel = null;
        }
    }

    private onBroadcast(value: unknown): void {
        const message = this.broadcastMessage(value);
        if (!message || message.ownerId !== this.desiredOwner || message.ownerId !== this.session.userId()
            || message.sourceId === this.sourceId) return;
        if (message.kind === 'hello') {
            if (this.leader) this.broadcastSnapshot();
            return;
        }
        if (this.leader || !this.enabled) return;
        this.metrics.set(message.metrics);
        this.state.set(message.state === 'live' ? 'standby' : message.state);
    }

    private sendHello(): void {
        if (!this.channel || !this.desiredOwner) return;
        this.channel.postMessage({
            kind: 'hello',
            ownerId: this.desiredOwner,
            sourceId: this.sourceId,
        } satisfies TradovateLiveBroadcastMessage);
    }

    private broadcastSnapshot(): void {
        if (!this.channel || !this.desiredOwner || !this.leader) return;
        this.channel.postMessage({
            kind: 'snapshot',
            ownerId: this.desiredOwner,
            sourceId: this.sourceId,
            state: this.state(),
            metrics: this.metrics(),
            sentAt: Date.now(),
        } satisfies TradovateLiveBroadcastMessage);
    }

    private broadcastMessage(value: unknown): TradovateLiveBroadcastMessage | null {
        const message = this.asRecord(value);
        if (!message || (message['kind'] !== 'hello' && message['kind'] !== 'snapshot')) return null;
        if (typeof message['ownerId'] !== 'string' || typeof message['sourceId'] !== 'string') return null;
        if (message['kind'] === 'hello') return message as unknown as TradovateLiveBroadcastMessage;
        if (!Array.isArray(message['metrics']) || typeof message['state'] !== 'string') return null;
        return message as unknown as TradovateLiveBroadcastMessage;
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    }

    private isAuthFailure(error: unknown): boolean {
        const candidate = this.asRecord(error);
        const status = candidate?.['status'];
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        return status === 401 || status === 403 || message.includes('unauthorized') || message.includes('expired');
    }

    private shutdown(closeChannel: boolean): void {
        this.enabled = false;
        this.releaseLeaderAndSockets();
        this.metrics.set([]);
        this.state.set('off');
        if (closeChannel) {
            this.channel?.close();
            this.channel = null;
            this.channelOwner = null;
        }
    }
}
