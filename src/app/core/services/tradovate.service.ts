import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

export interface TradovateConfig {
    apiKey: string;
    apiSecret: string;
}

export interface TradovateFill {
    id: number;
    symbol: string;
    action: 'Buy' | 'Sell';
    qty: number;
    price: number;
    timestamp: string;
    orderId?: number;
    contractId?: number;
    accountId?: number;
}

export interface TradovateAccount {
    id: number;
    name: string;
    userId: number;
    accountType: string;
    active: boolean;
}

export interface TradovateConnection {
    id: string; // UUID
    name: string; // User-friendly name (e.g., "Take Profit Trader", "Apex Funded")
    token: string;
    config: {
        authMode: 'oauth' | 'direct';
        environment: 'demo' | 'live';
        username?: string;
        apiKey?: string;
        apiSecret?: string;
    };
    accounts: TradovateAccount[]; // Tradovate accounts under this connection
    selectedAccountIds?: number[]; // Selected accounts for this connection
    createdAt: string;
    lastSyncedAt?: string;
}


@Injectable({
    providedIn: 'root'
})
export class TradovateService {
    private liveBaseUrl = 'https://live.tradovateapi.com/v1';
    private demoBaseUrl = 'https://demo.tradovateapi.com/v1';
    private demoAuthUrl = 'https://demo.tradovateapi.com/v1/auth';

    // Reporting API URLs
    private liveRptUrl = 'https://rpt.tradovateapi.com/v1';
    private demoRptUrl = 'https://rpt-demo.tradovateapi.com/v1';

    // Multi-account support
    connections = signal<TradovateConnection[]>([]);
    activeConnectionId = signal<string | null>(null);

    // Computed values
    activeConnection = computed(() => {
        const connId = this.activeConnectionId();
        if (!connId) return null;
        return this.connections().find(c => c.id === connId) || null;
    });

    isConnected = computed(() => this.activeConnection() !== null);

    constructor(private http: HttpClient) {
        this.loadConnections();
        this.migrateOldStorage();
        this.cleanupOldKeys();
    }

    /**
     * Clean up old/conflicting localStorage keys from previous versions
     */
    private cleanupOldKeys(): void {
        // Remove old key with _id suffix that could conflict
        if (localStorage.getItem('tradovate_active_connection_id')) {
            localStorage.removeItem('tradovate_active_connection_id');
            console.log('[TradovateService] Cleaned up old tradovate_active_connection_id key');
        }
    }

    /**
     * Load connections from localStorage
     */
    private loadConnections(): void {
        const stored = localStorage.getItem('tradovate_connections');
        const storedActiveId = localStorage.getItem('tradovate_active_connection');

        if (stored) {
            try {
                const connections = JSON.parse(stored);
                this.connections.set(connections);

                // Load active connection ID from storage, or use first connection
                if (storedActiveId && connections.find((c: TradovateConnection) => c.id === storedActiveId)) {
                    this.activeConnectionId.set(storedActiveId);
                } else if (connections.length > 0) {
                    this.activeConnectionId.set(connections[0].id);
                    localStorage.setItem('tradovate_active_connection', connections[0].id);
                }
            } catch (err) {
                console.error('Failed to load connections:', err);
            }
        }
    }

    /**
     * Save connections to localStorage
     */
    private saveConnections(): void {
        localStorage.setItem('tradovate_connections', JSON.stringify(this.connections()));
    }

    /**
     * Migrate old single-token storage to new multi-connection format
     */
    private migrateOldStorage(): void {
        const oldToken = localStorage.getItem('tradovate_token');
        const oldConfig = localStorage.getItem('tradovate_config');
        const oldSelectedAccounts = localStorage.getItem('tradovate_selected_accounts');

        if (oldToken && oldConfig && this.connections().length === 0) {
            try {
                const config = JSON.parse(oldConfig);
                const selectedAccountIds = oldSelectedAccounts ? JSON.parse(oldSelectedAccounts) : [];

                const migrationConnection: TradovateConnection = {
                    id: this.generateId(),
                    name: 'Migrated Account',
                    token: oldToken,
                    config: {
                        authMode: config.authMode || 'oauth',
                        environment: config.environment || 'demo',
                        username: config.username,
                        apiKey: config.apiKey,
                        apiSecret: config.apiSecret
                    },
                    accounts: [],
                    selectedAccountIds: selectedAccountIds, // Migrate old selection
                    createdAt: new Date().toISOString()
                };

                this.connections.set([migrationConnection]);
                this.activeConnectionId.set(migrationConnection.id);
                this.saveConnections();

                // Clean up old storage
                localStorage.removeItem('tradovate_token');
                localStorage.removeItem('tradovate_config');
                localStorage.removeItem('tradovate_selected_accounts');

                console.log('[TradovateService] Migrated old token and account selection to new multi-connection format');
            } catch (err) {
                console.error('Failed to migrate old storage:', err);
            }
        }
    }

    /**
     * Generate a unique ID for connections
     */
    private generateId(): string {
        return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Add a new connection
     */
    addConnection(name: string, token: string, config: TradovateConnection['config']): string {
        const newConnection: TradovateConnection = {
            id: this.generateId(),
            name,
            token,
            config,
            accounts: [],
            createdAt: new Date().toISOString()
        };

        this.connections.update(conns => [...conns, newConnection]);
        this.saveConnections();

        // Set as active if it's the first connection
        if (this.connections().length === 1) {
            this.activeConnectionId.set(newConnection.id);
        }

        return newConnection.id;
    }

    /**
     * Update connection accounts (after fetching from API)
     */
    updateConnectionAccounts(connectionId: string, accounts: TradovateAccount[]): void {
        this.connections.update(conns =>
            conns.map(c => c.id === connectionId ? { ...c, accounts } : c)
        );
        this.saveConnections();
    }

    /**
     * Update connection last synced time
     */
    updateConnectionSyncTime(connectionId: string): void {
        this.connections.update(conns =>
            conns.map(c => c.id === connectionId ? { ...c, lastSyncedAt: new Date().toISOString() } : c)
        );
        this.saveConnections();
    }

    /**
     * Remove a connection
     */
    removeConnection(connectionId: string): void {
        this.connections.update(conns => conns.filter(c => c.id !== connectionId));
        this.saveConnections();

        // If we removed the active connection, set another one as active
        if (this.activeConnectionId() === connectionId) {
            const remaining = this.connections();
            const newActiveId = remaining.length > 0 ? remaining[0].id : null;
            this.activeConnectionId.set(newActiveId);
            if (newActiveId) {
                localStorage.setItem('tradovate_active_connection', newActiveId);
            } else {
                localStorage.removeItem('tradovate_active_connection');
            }
        }
    }

    /**
     * Set active connection
     */
    setActiveConnection(connectionId: string): void {
        const exists = this.connections().find(c => c.id === connectionId);
        if (exists) {
            this.activeConnectionId.set(connectionId);
            localStorage.setItem('tradovate_active_connection', connectionId);
        }
    }

    /**
     * Get config for active connection (for backward compatibility)
     */
    private getConfig(): any | null {
        const conn = this.activeConnection();
        return conn?.config || null;
    }

    /**
     * Get token for active connection (for backward compatibility)
     */
    private getToken(): string | null {
        const conn = this.activeConnection();
        return conn?.token || null;
    }

    private getBaseUrl(): string {
        const config = this.getConfig();
        return config?.environment === 'live' ? this.liveBaseUrl : this.demoBaseUrl;
    }

    private getRptUrl(): string {
        const config = this.getConfig();
        return config?.environment === 'live' ? this.liveRptUrl : this.demoRptUrl;
    }

    // Exchange OAuth code for an access token (Live/Funded)
    exchangeCodeForToken(code: string): Observable<any> {
        const config = this.getConfig();
        if (!config) return throwError(() => new Error('Tradovate configuration not found'));

        const isDemo = config.environment === 'demo';
        const body = {
            grant_type: 'authorization_code',
            code,
            client_id: config.apiKey,
            client_secret: config.apiSecret,
            redirect_uri: window.location.origin + '/settings/tradovate/callback'
        };

        const authUrl = isDemo
            ? 'https://demo.tradovateapi.com/v1/auth/oauthtoken'
            : 'https://live.tradovateapi.com/auth/oauthtoken';

        return this.http.post(authUrl, body).pipe(
            map((res: any) => {
                if (res.access_token) {
                    localStorage.setItem('tradovate_token', res.access_token);
                    return res;
                } else if (res.errorText) {
                    throw new Error(res.errorText);
                } else {
                    throw new Error('No access token received');
                }
            })
        );
    }

    // Simple Login - Just username/password, no API credentials needed
    simpleLogin(username: string, password: string, connectionName: string, environment: 'demo' | 'live' = 'demo'): Observable<{ connectionId: string }> {
        const body = {
            locale: 'en',
            login: username,
            password: password
        };

        const authUrl = environment === 'live'
            ? 'https://tv-live.tradovateapi.com/authorize'
            : 'https://tv-demo.tradovateapi.com/authorize';

        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        });

        return this.http.post(authUrl, body, { headers }).pipe(
            map((res: any) => {
                const accessToken = res.d?.access_token || res.access_token;

                if (accessToken) {
                    // Create new connection
                    const connectionId = this.addConnection(
                        connectionName,
                        accessToken,
                        {
                            authMode: 'direct',
                            environment,
                            username
                        }
                    );
                    return { connectionId };
                } else if (res.errorText) {
                    throw new Error(res.errorText);
                } else {
                    throw new Error('Login failed: No access token received.');
                }
            }),
            catchError(err => {
                const errorMsg = err.error?.errorText || err.message || 'Login failed. Please check your credentials.';
                return throwError(() => new Error(errorMsg));
            })
        );
    }


    getAccounts(): Observable<any[]> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected: Token missing from storage'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/account/list`, { headers });
    }


    getContract(contractId: number): Observable<any> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any>(`${this.getBaseUrl()}/contract/item`, {
            headers,
            params: { id: contractId.toString() }
        }).pipe(
            catchError(err => {
                console.error('Error fetching fills:', err);
                return throwError(() => err);
            })
        );
    }


    getFills(fromDate: Date): Observable<TradovateFill[]> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected: Token missing from storage'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        // Get all accounts first, then fetch fills for each
        return this.getAccounts().pipe(
            switchMap(accounts => {
                const selectedAccountIds = this.getSelectedAccountIds();
                const accountsToFetch = selectedAccountIds.length > 0
                    ? accounts.filter(a => selectedAccountIds.includes(a.id))
                    : accounts;

                console.log(`[TradovateService] Fetching fills for ${accountsToFetch.length} accounts`);

                // Fetch fills for each account
                const fillRequests = accountsToFetch.map(account =>
                    this.http.get<any[]>(`${this.getBaseUrl()}/fill/list`, {
                        headers,
                        params: { accountId: account.id.toString() }
                    }).pipe(
                        map(fills => fills.map(f => ({
                            ...f,
                            accountId: account.id
                        }))),
                        catchError(err => {
                            console.warn(`Failed to fetch fills for account ${account.id}:`, err);
                            return of([]);
                        })
                    )
                );

                // Combine all fills from all accounts
                return fillRequests.length > 0
                    ? fillRequests.reduce((acc$, curr$) =>
                        acc$.pipe(switchMap(acc => curr$.pipe(map(curr => [...acc, ...curr])))),
                        of([])
                    )
                    : of([]);
            }),
            catchError(err => {
                console.error('Error fetching fills:', err);
                return throwError(() => err);
            })
        );
    }

    getCashBalances(): Observable<any[]> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/cashBalance/list`, { headers });
    }

    // Get cash balance for a specific account
    getCashBalanceForAccount(accountId: number): Observable<any> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any>(`${this.getBaseUrl()}/cashBalance/item`, {
            headers,
            params: { accountId: accountId.toString() }
        });
    }

    // Account selection management (per-connection)
    getSelectedAccountIds(): number[] {
        const activeConn = this.activeConnection();
        if (!activeConn) return [];

        // Return selected accounts for active connection, or empty array if none selected
        return activeConn.selectedAccountIds || [];
    }

    setSelectedAccountIds(accountIds: number[]): void {
        const activeConnId = this.activeConnectionId();
        if (!activeConnId) return;

        // Update selected accounts for active connection
        this.connections.update(conns =>
            conns.map(c => c.id === activeConnId ? { ...c, selectedAccountIds: accountIds } : c)
        );
        this.saveConnections();
    }

    // Check if any accounts are selected, if not, select all by default
    initializeAccountSelection(accounts: TradovateAccount[]): void {
        const selected = this.getSelectedAccountIds();
        if (selected.length === 0 && accounts.length > 0) {
            // Default: select all accounts
            this.setSelectedAccountIds(accounts.map(a => a.id));
        }
    }

    getOrders(): Observable<any[]> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/order/list`, { headers });
    }

    getMarketData(symbol: string, timeframe: string = '15min', barsCount: number = 100): Promise<any> {
        const token = this.getToken();
        const wsUrl = 'wss://md.tradovateapi.com/v1/websocket';

        console.log(`[TradovateWS] Connecting to ${wsUrl} (Raw) for ${symbol} (${timeframe}, ${barsCount} bars)...`);

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            let authorized = false;

            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Market data request timed out (WebSocket). This is often due to Tradovate accounts lacking a CME Real-Time Market Data subscription.'));
            }, 10000);

            ws.onopen = () => {
                console.log('[TradovateWS] Connection opened. Authorizing (Raw)...');
                ws.send(`authorize\n${messageId++}\n\n${token}`);
            };

            ws.onmessage = (event) => {
                const msg = event.data;
                console.log(`[TradovateWS] Frame received: ${msg.substring(0, 100)}`);

                if (msg === 'o' || msg === 'h' || msg.startsWith('c')) return;

                if (msg.startsWith('a')) {
                    try {
                        const data = JSON.parse(msg.substring(1));
                        data.forEach((item: any) => {
                            // Check for Auth success
                            if (!authorized && item.s === 200) {
                                authorized = true;
                                console.log('[TradovateWS] Authorized. Requesting chart...');
                                // Map timeframe to Tradovate chart description
                                const chartDesc = this.getChartDescription(timeframe, barsCount);

                                const chartRequest = {
                                    symbol: symbol,
                                    chartDescription: chartDesc,
                                    timeRange: {
                                        asFarAsTimestamp: new Date().toISOString()
                                    }
                                };
                                ws.send(`md/getchart\n${messageId++}\n\n${JSON.stringify(chartRequest)}`);
                            }
                            // Check for Chart success
                            else if (item.s === 200 && item.d && item.d.bars) {
                                console.log(`[TradovateWS] Received ${item.d.bars.length} bars.`);
                                clearTimeout(timeout);
                                const bars = item.d.bars.map((b: any) => ({
                                    timestamp: b.timestamp,
                                    open: b.open,
                                    high: b.high,
                                    low: b.low,
                                    close: b.close,
                                    volume: (b.upVolume || 0) + (b.downVolume || 0)
                                }));
                                ws.close();
                                resolve(bars);
                            }
                            // Check for specific Errors
                            else if (item.s && item.s >= 400) {
                                console.warn('[TradovateWS] Error frame received:', item);
                                clearTimeout(timeout);
                                ws.close();
                                reject(new Error(`Tradovate MD Error ${item.s}: ${item.d?.errorText || 'Unknown. Possibly missing MD subscription.'}`));
                            }
                        });
                    } catch (e) {
                        console.error('[TradovateWS] Parse Error', e);
                    }
                }
            };

            ws.onerror = (err) => {
                console.error('[TradovateWS] WebSocket Error', err);
                clearTimeout(timeout);
                reject(new Error('WebSocket connection failed.'));
            };
        });
    }

    /**
     * Get historical fills using the Reports API
     * This can fetch fills from previous days (unlike the standard /fill/list which is often limited to current day)
     */
    getHistoricalFillsReport(startDate: Date, endDate?: Date, accountId?: number): Observable<any> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        const end = endDate || new Date();
        const params: any = {
            startDate: startDate.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0]
        };

        if (accountId) {
            params.accountId = accountId.toString();
        }

        console.log(`[TradovateService] 📊 Requesting historical fill report (GET Item):`, {
            url: `${this.getRptUrl()}/fillReport/item`,
            params
        });

        return this.http.get(`${this.getRptUrl()}/fillReport/item`, { headers, params }).pipe(
            tap(response => console.log(`[TradovateService] 📥 Report Response:`, response)),
            catchError(err => {
                console.error('❌ Error requesting fill report item:', err);
                return throwError(() => err);
            })
        );
    }

    /**
     * Polls for report status and retrieves data when complete
     */

    /**
     * Get all fills (current + historical) for a date range
     * Combines standard getFills with historical report data for comprehensive history
     */
    getAllFills(startDate: Date, endDate?: Date): Observable<TradovateFill[]> {
        const token = this.getToken();
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const end = endDate || new Date();

        console.log(`[TradovateService] Fetching all fills from ${startDate.toISOString()} to ${end.toISOString()}`);

        // Get all accounts first
        return this.getAccounts().pipe(
            switchMap(accounts => {
                const selectedAccountIds = this.getSelectedAccountIds();
                const accountsToFetch = selectedAccountIds.length > 0
                    ? accounts.filter(a => selectedAccountIds.includes(a.id))
                    : accounts;

                // For each account, fetch fills using Reports API
                const fillRequests = accountsToFetch.map(account =>
                    this.getHistoricalFillsReport(startDate, end, account.id).pipe(
                        map((report: any[]) => {
                            // The /fillReport/item endpoint likely returns an array of fill objects directly
                            if (!Array.isArray(report)) {
                                console.warn('[TradovateService] Unexpected report format:', report);
                                return [];
                            }

                            return report.map((f: any) => ({
                                id: f.id || f.fillId || `fill-${Math.random()}`,
                                symbol: f.contract || f.symbol,
                                action: ((f.action || f.side || '').toLowerCase().includes('buy') ? 'Buy' : 'Sell') as 'Buy' | 'Sell',
                                qty: f.qty || f.quantity,
                                price: f.price,
                                timestamp: f.timestamp || f.time, // ISO string likely
                                orderId: f.orderId,
                                contractId: f.contractId,
                                accountId: account.id
                            }));
                        }),
                        catchError(err => {
                            console.warn(`Failed to fetch historical fills for account ${account.id}:`, err);
                            return of([]);
                        })
                    )
                );

                // Combine all fills from all accounts
                return fillRequests.length > 0
                    ? fillRequests.reduce((acc$, curr$) =>
                        acc$.pipe(switchMap(acc => curr$.pipe(map(curr => [...acc, ...curr])))),
                        of([])
                    )
                    : of([]);
            }),
            catchError(err => {
                console.error('Error fetching all fills:', err);
                return throwError(() => err);
            })
        );
    }

    private getChartDescription(timeframe: string, barsCount: number): any {
        // Map user-friendly timeframe to Tradovate chart description
        const timeframeMap: { [key: string]: any } = {
            '1min': { underlyingType: 'MinuteBar', elementSize: 1, elementSizeUnit: 'UnderlyingUnits' },
            '5min': { underlyingType: 'MinuteBar', elementSize: 5, elementSizeUnit: 'UnderlyingUnits' },
            '15min': { underlyingType: 'MinuteBar', elementSize: 15, elementSizeUnit: 'UnderlyingUnits' },
            '30min': { underlyingType: 'MinuteBar', elementSize: 30, elementSizeUnit: 'UnderlyingUnits' },
            '1hr': { underlyingType: 'MinuteBar', elementSize: 60, elementSizeUnit: 'UnderlyingUnits' },
            '4hr': { underlyingType: 'MinuteBar', elementSize: 240, elementSizeUnit: 'UnderlyingUnits' },
            'Daily': { underlyingType: 'DailyBar', elementSize: 1, elementSizeUnit: 'UnderlyingUnits' }
        };

        const desc = timeframeMap[timeframe] || timeframeMap['15min'];

        return {
            ...desc,
            withHistogram: false,
            asMuchAsElements: barsCount
        };
    }
}
