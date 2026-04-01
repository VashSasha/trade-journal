import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of, timer, from } from 'rxjs';
import { catchError, map, switchMap, tap, takeWhile, mergeMap, filter, concatMap, reduce } from 'rxjs/operators';

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
    timestamp?: string; // ISO date string from /account/list — when the account was created
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

    private http = inject(HttpClient);

    // Multi-account support
    connections = signal<TradovateConnection[]>([]);
    activeConnectionId = signal<string | null>(null);

    // Cached accounts for active connection
    accounts = signal<TradovateAccount[]>([]);

    // Tracks which connection IDs have expired tokens
    expiredConnectionIds = signal<string[]>([]);

    // Computed values
    activeConnection = computed(() => {
        const connId = this.activeConnectionId();
        if (!connId) return null;
        return this.connections().find(c => c.id === connId) || null;
    });

    isConnected = computed(() => this.activeConnection() !== null);

    expiredConnections = computed(() => {
        const ids = this.expiredConnectionIds();
        return this.connections().filter(c => ids.includes(c.id));
    });

    hasExpiredConnections = computed(() => this.expiredConnections().length > 0);

    private _init = this.init();

    private init(): void {
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
     * Update the token for an existing connection in-place (used on re-auth)
     */
    updateConnectionToken(connectionId: string, token: string): void {
        this.connections.update(conns =>
            conns.map(c => c.id === connectionId ? { ...c, token } : c)
        );
        this.clearExpiredConnection(connectionId);
        this.accounts.set([]); // invalidate cached accounts
        this.saveConnections();
    }

    /**
     * Re-authenticate an expired direct-auth connection using stored username.
     * Password must be supplied by the user (it is never stored).
     */
    reconnectConnection(connectionId: string, password: string): Observable<void> {
        const conn = this.connections().find(c => c.id === connectionId);
        if (!conn) return throwError(() => new Error('Connection not found'));
        if (conn.config.authMode !== 'direct' || !conn.config.username) {
            return throwError(() => new Error('Cannot auto-reconnect OAuth connections'));
        }

        const { username, environment = 'demo' } = conn.config;
        const authUrl = environment === 'live'
            ? 'https://tv-live.tradovateapi.com/authorize'
            : 'https://tv-demo.tradovateapi.com/authorize';

        const headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' });

        return this.http.post(authUrl, { locale: 'en', login: username, password }, { headers }).pipe(
            map((res: any) => {
                const token = res.d?.access_token || res.access_token;
                if (!token) throw new Error(res.errorText || 'No access token received');
                this.updateConnectionToken(connectionId, token);
            }),
            catchError(err => throwError(() => new Error(
                err.error?.errorText || err.message || 'Reconnection failed'
            )))
        );
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
        this.clearExpiredConnection(connectionId);
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
            this.accounts.set([]); // Invalidate cache on connection switch
        }
    }

    /**
     * Mark a connection's token as expired (called on 401 responses)
     */
    markConnectionExpired(connectionId: string): void {
        this.expiredConnectionIds.update(ids =>
            ids.includes(connectionId) ? ids : [...ids, connectionId]
        );
    }

    /**
     * Clear expired flag for a connection (called after successful re-auth)
     */
    clearExpiredConnection(connectionId: string): void {
        this.expiredConnectionIds.update(ids => ids.filter(id => id !== connectionId));
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

    /**
     * Get authenticated headers for API requests
     */
    private getAuthHeaders(): HttpHeaders {
        const token = this.getToken();
        return new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });
    }

    /**
     * Ensure we have a valid token, throws if not connected
     */
    private requireToken(): string {
        const token = this.getToken();
        if (!token) {
            throw new Error('Tradovate not connected');
        }
        return token;
    }

    /**
     * Execute an authenticated GET request.
     * Intercepts 401 responses to mark the active connection as expired.
     */
    private authGet<T>(endpoint: string, params?: Record<string, string>): Observable<T> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        return this.http.get<T>(`${this.getBaseUrl()}${endpoint}`, {
            headers: this.getAuthHeaders(),
            params
        }).pipe(
            catchError(err => {
                if (err?.status === 401 || err?.error?.errorText?.toLowerCase().includes('expired')) {
                    const connId = this.activeConnectionId();
                    if (connId) this.markConnectionExpired(connId);
                }
                return throwError(() => err);
            })
        );
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


    getAccounts(): Observable<TradovateAccount[]> {
        const cached = this.accounts();
        if (cached.length > 0) {
            return of(cached);
        }
        return this.authGet<TradovateAccount[]>('/account/list').pipe(
            tap(accounts => this.accounts.set(accounts))
        );
    }

    getContract(contractId: number): Observable<any> {
        return this.authGet<any>('/contract/item', { id: contractId.toString() }).pipe(
            catchError(err => {
                console.error('Error fetching contract:', err);
                return throwError(() => err);
            })
        );
    }

    getCashBalances(): Observable<any[]> {
        return this.authGet<any[]>('/cashBalance/list');
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
     * Format date as MM/DD/YYYY for Tradovate Reports API
     */
    private formatDateForReport(d: Date): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
    }

    /**
     * Parse response data from the Reports API into fills.
     * The API returns HTML (not raw CSV/JSON) even when representationType='csv' is requested.
     * Detects HTML and routes to the appropriate parser.
     */
    private parseReportCsvResponse(raw: string, accountId: number): any[] {
        if (!raw || raw.trim().length === 0 || raw.trim() === '\r\n') return [];
        const trimmed = raw.trim();
        if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<table')) {
            return this.parseReportHtml(trimmed, accountId);
        }
        return this.parseFillsCsv(raw, accountId);
    }

    /**
     * Parse an HTML table response from the Reports API.
     * Uses DOMParser (available in browser/Electron) to extract rows.
     */
    private parseReportHtml(html: string, accountId: number): any[] {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const table = doc.querySelector('table');
            if (!table) {
                console.warn('[TradovateService] HTML response contained no <table> element. Raw:', html.slice(0, 300));
                return [];
            }

            // Build header → column-index map (case-insensitive)
            const headerRow = table.querySelector('thead tr, tr');
            if (!headerRow) return [];
            const headers = Array.from(headerRow.querySelectorAll('th, td'))
                .map(el => el.textContent?.trim().toLowerCase() ?? '');

            // col() returns the index of the FIRST header that contains any of the given strings.
            // List more-specific terms first to avoid matching the wrong column.
            // e.g. 'avg fill price' must come before 'price' to avoid matching 'limit price'.
            const col = (names: string[]) => {
                for (const name of names) {
                    const idx = headers.findIndex(h => h.includes(name));
                    if (idx !== -1) return idx;
                }
                return -1;
            };

            const idxId        = col(['order id', 'fill id', 'fillid']);
            const idxSymbol    = col(['contract', 'symbol']);
            const idxAction    = col(['b/s', 'side', 'action', 'buy/sell']);
            const idxFilledQty = col(['filled qty', 'fill qty', 'qty', 'quantity']);
            const idxPrice     = col(['avg fill price', 'fill price', 'price']);
            const idxFillTime  = col(['fill time', 'timestamp', 'date']);
            const idxStatus    = col(['status']);
            const idxAccount   = col(['account']);

            console.log('[TradovateService] Report columns:', headers);

            const val = (cells: NodeListOf<Element>, idx: number) =>
                idx >= 0 ? cells[idx]?.textContent?.trim() ?? '' : '';

            const fills: any[] = [];
            const rows = table.querySelectorAll('tbody tr, tr');
            rows.forEach((row, rowIdx) => {
                if (rowIdx === 0 && row === headerRow) return; // skip header row
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // Skip header rows
                if (cells[0].tagName.toLowerCase() === 'th') return;

                // Skip unfilled/canceled orders — only process rows that were actually filled
                const status = val(cells, idxStatus).toLowerCase();
                if (status && !status.includes('filled')) return;

                const filledQtyStr = val(cells, idxFilledQty);
                if (!filledQtyStr) return; // no fill quantity = not filled

                const idStr = val(cells, idxId);
                if (!idStr) return;

                let timestamp = val(cells, idxFillTime);
                if (timestamp && !timestamp.includes('T')) {
                    try { timestamp = new Date(timestamp).toISOString(); } catch { /* keep as-is */ }
                }

                const actionRaw = val(cells, idxAction).toLowerCase();
                fills.push({
                    id: idStr,
                    symbol: val(cells, idxSymbol),
                    action: (actionRaw.includes('buy') || actionRaw === 'b' ? 'Buy' : 'Sell') as 'Buy' | 'Sell',
                    qty: parseFloat(filledQtyStr) || 0,
                    price: parseFloat(val(cells, idxPrice)) || 0,
                    timestamp,
                    accountId,
                    accountName: idxAccount >= 0 ? val(cells, idxAccount) : undefined
                });
            });

            console.log(`[TradovateService] HTML parser extracted ${fills.length} fills from report table`);
            return fills;
        } catch (err) {
            console.error('[TradovateService] HTML report parsing failed:', err);
            return [];
        }
    }

    /**
     * Handle p-ticket long-polling for Tradovate Reports API
     */
    private pollWithPTicket(
        url: string,
        body: any,
        ticket: string,
        waitMs: number,
        accountId: number,
        attempt: number = 1
    ): Observable<any[]> {
        if (attempt > 30) {
            console.warn('[TradovateService] p-ticket polling exceeded 30 attempts');
            return of([]);
        }

        console.log(`[TradovateService] p-ticket poll #${attempt}, waiting ${waitMs / 1000}s...`);

        const headers = this.getAuthHeaders()
            .set('Content-Type', 'application/json')
            .set('p-ticket', ticket);

        return timer(waitMs).pipe(
            switchMap(() => this.http.post(url, body, { headers, responseType: 'text' })),
            map((raw: string) => {
                try { return JSON.parse(raw); } catch { return { data: raw }; }
            }),
            switchMap((res: any) => {
                if (res.data && typeof res.data === 'string') {
                    const fills = this.parseReportCsvResponse(res.data, accountId);
                    console.log(`[TradovateService] Parsed ${fills.length} fills after ${attempt} poll(s)`);
                    return of(fills);
                }
                if (res['p-ticket']) {
                    const msg: string = res['p-message'] || '';
                    if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('limit exceeded')) {
                        console.warn(`[TradovateService] Rate limited by Tradovate: ${msg}`);
                        return throwError(() => new Error(`Tradovate rate limit exceeded. Please wait before syncing again.`));
                    }
                    const nextWait = Math.max((res['p-time'] || 2) * 1000, 2000);
                    return this.pollWithPTicket(url, body, res['p-ticket'], nextWait, accountId, attempt + 1);
                }
                if (res.errorText) {
                    console.warn(`[TradovateService] p-ticket error: ${res.errorText}`);
                    return of([]);
                }
                console.warn('[TradovateService] Unexpected p-ticket response:', res);
                return of([]);
            }),
            catchError(err => {
                console.error(`[TradovateService] p-ticket poll #${attempt} error:`, err);
                return of([]);
            })
        );
    }

    /**
     * Get historical fills using the Tradovate Reports API.
     * /fill/list only returns current-day data.
     * The Reports API is the official way to fetch historical fills.
     */
    getHistoricalReportsAPI(startDate: Date, endDate?: Date, accountName?: string): Observable<any[]> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        const end = endDate || new Date();
        const url = `${this.getRptUrl()}/reports/requestreport`;
        const timezone = -new Date().getTimezoneOffset(); // e.g. -300 for EST

        const params: any[] = [
            { name: 'startDate', value: this.formatDateForReport(startDate) },
            { name: 'endDate',   value: this.formatDateForReport(end) },
            { name: 'startTime', value: '00:00:00' },
            { name: 'endTime',   value: '23:59:59' },
        ];
        if (accountName) {
            params.push({ name: 'account', value: accountName });
        }

        const body: any = {
            name: 'Orders',
            timezone,
            params,
            representationType: 'html'
        };

        console.log(`[TradovateService] Requesting Fills report: ${startDate.toISOString()} → ${end.toISOString()}${accountName ? ` (${accountName})` : ''}`);

        const headers = this.getAuthHeaders().set('Content-Type', 'application/json');

        return this.http.post(url, body, { headers, responseType: 'text' }).pipe(
            tap((raw: string) => console.log(`[TradovateService] Raw report response (${accountName}):`, raw.slice(0, 500))),
            map((raw: string) => {
                try {
                    return JSON.parse(raw);
                } catch {
                    // Inline HTML/CSV response — wrap so handleReportResponse can process it
                    return { data: raw };
                }
            }),
            switchMap((res: any) => this.handleReportResponse(res, url, body, 0)),
            catchError(err => {
                console.error(`[TradovateService] Reports API error for account ${accountName}:`, err);
                if (err?.status === 401 || err?.error?.errorText?.toLowerCase().includes('expired')) {
                    const connId = this.activeConnectionId();
                    if (connId) this.markConnectionExpired(connId);
                }
                return this.handleReportError(err);
            })
        );
    }

    /**
     * Handle the various response types from the Reports API
     */
    private handleReportResponse(res: any, url: string, body: any, accountId: number): Observable<any[]> {
        // Inline CSV data
        if (res.data && typeof res.data === 'string') {
            const fills = this.parseReportCsvResponse(res.data, accountId);
            console.log(`[TradovateService] Parsed ${fills.length} fills from inline CSV`);
            return of(fills);
        }

        // Report ID for polling
        const reportId = res.reportId || res.id;
        if (reportId) {
            console.log(`[TradovateService] Report queued (ID: ${reportId}). Polling...`);
            return this.pollReportStatus(reportId).pipe(
                filter((pollRes: any) => typeof pollRes === 'string' && pollRes.length > 0),
                map((csv: string) => this.parseReportCsvResponse(csv, accountId))
            );
        }

        // P-ticket long-polling
        const pTicket = res['p-ticket'];
        if (pTicket) {
            const waitMs = Math.max((res['p-time'] || 2) * 1000, 2000);
            return this.pollWithPTicket(url, body, pTicket, waitMs, accountId);
        }

        // Error response — flag auth errors so callers can bail out immediately
        if (res.errorText) {
            const msg = res.errorText as string;
            const isAuth = msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized');
            const err = new Error(`Report API: ${msg}`);
            if (isAuth) {
                const connId = this.activeConnectionId();
                if (connId) this.markConnectionExpired(connId);
                (err as any).isAuthError = true;
            }
            return throwError(() => err);
        }

        console.warn('[TradovateService] Unexpected response format:', res);
        return of([]);
    }

    /**
     * Returns true for 401 / expired-token errors — these should stop sync immediately,
     * not trigger per-chunk fallback calls.
     */
    private isAuthError(err: any): boolean {
        if (err?.isAuthError) return true;
        if (err?.status === 401) return true;
        const msg = (err?.error?.errorText || err?.message || '').toLowerCase();
        return msg.includes('expired') || msg.includes('unauthorized') || msg.includes('not authenticated');
    }

    /**
     * Handle errors in report fetching.
     * Auth errors (expired token) are re-thrown immediately — no fallback — so the
     * caller can bail out of remaining chunks rather than hammering the API.
     * Non-auth errors fall back to /fill/list for current-day data.
     */
    private handleReportError(err: any, accountId?: number): Observable<any[]> {
        if (this.isAuthError(err)) {
            console.warn('[TradovateService] Auth error in Reports API — skipping fallback, token expired.');
            return throwError(() => err);
        }

        console.error('Error in Report API workflow:', err);
        console.log('[TradovateService] Falling back to /fill/list (current-day only)...');

        const params: Record<string, string> = {};
        if (accountId) params['accountId'] = accountId.toString();

        return this.authGet<any[]>('/fill/list', params).pipe(
            tap(fills => console.log(`[TradovateService] Fallback returned ${fills?.length ?? 0} fills`)),
            catchError(() => of([]))
        );
    }

    private pollReportStatus(reportId: number): Observable<any> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        const MAX_POLLS = 60; // 1s initial + 60 × 2s = ~2 min max
        let pollCount = 0;

        return timer(1000, 2000).pipe(
            mergeMap(() => {
                if (++pollCount > MAX_POLLS) {
                    return throwError(() => new Error(`Report ${reportId} polling timed out after ${MAX_POLLS} attempts`));
                }
                return this.http.get<any>(
                    `${this.getRptUrl()}/reports/pollreportstatus?reportId=${reportId}`,
                    { headers: this.getAuthHeaders() }
                );
            }),
            tap(status => console.log(`[TradovateService] Report ${reportId} status:`, status)),
            takeWhile(status => status.status !== 'Complete', true),
            switchMap(status => {
                if (status.status === 'Complete') return this.downloadReport(reportId);
                if (status.status === 'Failed') return throwError(() => new Error('Report failed'));
                return of(null);
            })
        );
    }

    private downloadReport(reportId: number): Observable<string> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        return this.http.get(`${this.getRptUrl()}/reports/downloadreport?reportId=${reportId}`, {
            headers: this.getAuthHeaders(),
            responseType: 'text'
        });
    }

    /**
     * Split a date range into chunks of maxMonths each.
     * Tradovate Reports API rejects ranges that are "Too long".
     */
    private chunkDateRange(start: Date, end: Date, maxMonths: number = 3): { start: Date; end: Date }[] {
        const chunks: { start: Date; end: Date }[] = [];
        let chunkStart = new Date(start);

        while (chunkStart < end) {
            const chunkEnd = new Date(chunkStart);
            chunkEnd.setMonth(chunkEnd.getMonth() + maxMonths);
            if (chunkEnd > end) chunkEnd.setTime(end.getTime());

            chunks.push({ start: new Date(chunkStart), end: new Date(chunkEnd) });
            chunkStart = new Date(chunkEnd);
        }

        return chunks;
    }

    /**
     * Normalize raw fill data to TradovateFill interface.
     * Tradovate /fill/list returns: id, orderId, contractId, timestamp, tradeDate, action, qty, price, active, finallyPaired
     */
    private normalizeFill(f: any, accountId: number): TradovateFill {
        // Resolve timestamp: prefer ISO string, fall back to tradeDate object
        let timestamp = f.timestamp || f.time;
        if (!timestamp && f.tradeDate) {
            const td = f.tradeDate;
            timestamp = `${td.year}-${String(td.month).padStart(2, '0')}-${String(td.day).padStart(2, '0')}T00:00:00.000Z`;
        }

        return {
            id: f.id || f.fillId || `fill-${Math.random()}`,
            symbol: f.contract || f.symbol || '',
            action: ((f.action || f.side || '').toLowerCase().includes('buy') ? 'Buy' : 'Sell') as 'Buy' | 'Sell',
            qty: f.qty || f.quantity || 0,
            price: f.price || 0,
            timestamp,
            orderId: f.orderId,
            contractId: f.contractId,
            accountId: f.accountId || accountId
        };
    }

    /**
     * Get all fills via the Reports API for the full date range.
     * Account IDs are resolved from the "Account" column in the HTML response.
     */
    getAllFills(startDate: Date | null, endDate?: Date): Observable<TradovateFill[]> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        const end = endDate || new Date();
        console.log(`[TradovateService] getAllFills: ${startDate?.toISOString() ?? 'account start'} → ${end.toISOString()}`);

        return this.getAccounts().pipe(
            switchMap(accounts => {
                if (accounts.length === 0) return of([] as TradovateFill[]);

                const effectiveStart = startDate ?? accounts.reduce<Date>((earliest, a) => {
                    const ts = a.timestamp ? new Date(a.timestamp) : new Date(2020, 0, 1);
                    return ts < earliest ? ts : earliest;
                }, new Date());

                const chunks = this.chunkDateRange(effectiveStart, end, 1);
                console.log(`[TradovateService] ${chunks.length} chunk(s) × ${accounts.length} account(s) via Reports API`);

                const requests: Observable<TradovateFill[]>[] = [];
                for (const account of accounts) {
                    for (const chunk of chunks) {
                        requests.push(
                            this.getHistoricalReportsAPI(chunk.start, chunk.end, account.name).pipe(
                                map(rawFills => {
                                    console.log(`[TradovateService] Got ${rawFills.length} fills for ${account.name}`);
                                    return rawFills.map(f => this.normalizeFill(f, account.id));
                                }),
                                catchError(err => {
                                    if (this.isAuthError(err)) return throwError(() => err);
                                    console.error(`[TradovateService] Failed for account ${account.name}:`, err);
                                    return of([] as TradovateFill[]);
                                })
                            )
                        );
                    }
                }

                return from(requests).pipe(
                    concatMap(req$ => req$),
                    reduce((all, chunk) => [...all, ...chunk], [] as TradovateFill[])
                );
            }),
            catchError(err => {
                if (this.isAuthError(err)) return throwError(() => err);
                console.warn('[TradovateService] Reports API failed:', err);
                return of([] as TradovateFill[]);
            })
        );
    }

    /**
     * Parse a P&L string from the Performance report.
     * "$(38.00)" → -38  |  "$106.00" → 106  |  "$1,054.00" → 1054
     */
    private parsePerformancePnl(raw: string): number {
        const isNegative = raw.includes('(');
        const value = parseFloat(raw.replace(/[$(),\s]/g, '')) || 0;
        return isNegative ? -value : value;
    }

    /**
     * Parse the "Trades" table from a Performance report HTML response.
     * Each row is a completed, already-matched trade.
     */
    private parsePerformanceTrades(html: string, accountId: number, accountName: string): any[] {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // Find the .performance-chart section whose <h5> says "Trades"
            let tradesTable: Element | null = null;
            doc.querySelectorAll('.performance-chart').forEach(chart => {
                if (chart.querySelector('h5')?.textContent?.trim() === 'Trades') {
                    tradesTable = chart.querySelector('table');
                }
            });

            if (!tradesTable) {
                console.warn('[TradovateService] Performance report: no Trades table found');
                return [];
            }

            const trades: any[] = [];
            (tradesTable as Element).querySelectorAll('tbody tr').forEach((row, i) => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 8) return;

                const symbol      = cells[0].textContent?.trim() ?? '';
                const quantity    = parseFloat(cells[1].textContent?.trim() ?? '0') || 0;
                const buyPrice    = parseFloat(cells[2].textContent?.trim() ?? '0') || 0;
                const buyTimeStr  = cells[3].textContent?.trim() ?? '';
                // cells[4] = Duration — skip
                const sellTimeStr = cells[5].textContent?.trim() ?? '';
                const sellPrice   = parseFloat(cells[6].textContent?.trim() ?? '0') || 0;
                const pnl         = this.parsePerformancePnl(cells[7].textContent?.trim() ?? '');

                if (!symbol || !quantity || !buyTimeStr || !sellTimeStr) return;

                const buyTime  = new Date(buyTimeStr);
                const sellTime = new Date(sellTimeStr);

                if (isNaN(buyTime.getTime()) || isNaN(sellTime.getTime())) return;

                // If sell happened before buy → SHORT (sold to enter, bought to cover)
                const isShort    = sellTime < buyTime;
                const entryDate  = (isShort ? sellTime : buyTime).toISOString();
                const exitDate   = (isShort ? buyTime  : sellTime).toISOString();
                const entryPrice = isShort ? sellPrice : buyPrice;
                const exitPrice  = isShort ? buyPrice  : sellPrice;
                const pnlPercent = entryPrice
                    ? ((isShort ? entryPrice - exitPrice : exitPrice - entryPrice) / entryPrice) * 100
                    : 0;

                trades.push({
                    symbol,
                    assetType: 'futures',
                    direction: isShort ? 'short' : 'long',
                    quantity,
                    entryDate,
                    exitDate,
                    entryPrice,
                    exitPrice,
                    pnl,
                    pnlPercent,
                    status: 'closed',
                    accountId: String(accountId),
                    accountName,
                    externalId: `tradovate_perf_${symbol}_${entryDate}_${exitDate}`
                });
            });

            console.log(`[TradovateService] Performance parser extracted ${trades.length} trades`);
            return trades;
        } catch (err) {
            console.error('[TradovateService] Performance report parsing failed:', err);
            return [];
        }
    }

    /**
     * Request a Performance report for one account/chunk and return parsed trades.
     * Handles p-ticket long-polling (up to 30 attempts).
     */
    getPerformanceTrades(
        startDate: Date,
        endDate: Date,
        accountName: string,
        accountId: number,
        attempt: number = 0,
        pTicket?: string
    ): Observable<any[]> {
        try { this.requireToken(); } catch (e) { return throwError(() => e); }

        const url = `${this.getRptUrl()}/reports/requestreport`;
        const timezone = -new Date().getTimezoneOffset();
        const body = {
            name: 'Performance',
            representationType: 'html',
            template: 'Flex.html',
            timezone,
            params: [
                { name: 'startDate', value: this.formatDateForReport(startDate) },
                { name: 'endDate',   value: this.formatDateForReport(endDate) },
                { name: 'startTime', value: '00:00:00' },
                { name: 'endTime',   value: '23:59:59' },
                { name: 'account',   value: accountName }
            ]
        };

        let headers = this.getAuthHeaders().set('Content-Type', 'application/json');
        if (pTicket) headers = headers.set('p-ticket', pTicket);

        const waitMs = pTicket ? 2000 : 0;

        return timer(waitMs).pipe(
            switchMap(() => this.http.post(url, body, { headers, responseType: 'text' })),
            map((raw: string) => {
                try { return JSON.parse(raw); } catch { return { data: raw }; }
            }),
            switchMap((res: any): Observable<any[]> => {
                if (res.data && typeof res.data === 'string') {
                    return of(this.parsePerformanceTrades(res.data, accountId, accountName));
                }
                if (res['p-ticket']) {
                    if (attempt >= 30) {
                        console.warn('[TradovateService] Performance report polling timed out');
                        return of([]);
                    }
                    const msg: string = res['p-message'] || '';
                    if (msg.toLowerCase().includes('rate limit')) {
                        return throwError(() => new Error('Tradovate rate limit exceeded'));
                    }
                    const nextWait = Math.max((res['p-time'] || 2) * 1000, 2000);
                    console.log(`[TradovateService] Performance p-ticket poll #${attempt + 1}, waiting ${nextWait / 1000}s...`);
                    return timer(nextWait).pipe(
                        switchMap(() => this.getPerformanceTrades(startDate, endDate, accountName, accountId, attempt + 1, res['p-ticket']))
                    );
                }
                if (res.errorText) {
                    const err = new Error(`Performance Report API: ${res.errorText}`);
                    if (this.isAuthError({ message: res.errorText })) {
                        const connId = this.activeConnectionId();
                        if (connId) this.markConnectionExpired(connId);
                        (err as any).isAuthError = true;
                    }
                    return throwError(() => err);
                }
                console.warn('[TradovateService] Unexpected Performance report response:', res);
                return of([]);
            }),
            catchError(err => {
                if (this.isAuthError(err)) return throwError(() => err);
                console.error(`[TradovateService] Performance report error for ${accountName}:`, err);
                return of([] as any[]);
            })
        );
    }

    /**
     * Get all pre-matched trades from the Performance report for all accounts and the full date range.
     */
    getAllTrades(startDate: Date | null, endDate?: Date): Observable<any[]> {
        try { this.requireToken(); } catch (e) { return throwError(() => e); }

        const end = endDate || new Date();
        console.log(`[TradovateService] getAllTrades: ${startDate?.toISOString() ?? 'account start'} → ${end.toISOString()}`);

        return this.getAccounts().pipe(
            switchMap(accounts => {
                if (accounts.length === 0) return of([] as any[]);

                const effectiveStart = startDate ?? accounts.reduce<Date>((earliest, a) => {
                    const ts = a.timestamp ? new Date(a.timestamp) : new Date(2020, 0, 1);
                    return ts < earliest ? ts : earliest;
                }, new Date());

                const chunks = this.chunkDateRange(effectiveStart, end, 1);
                console.log(`[TradovateService] getAllTrades: ${chunks.length} chunk(s) × ${accounts.length} account(s)`);

                const requests: Observable<any[]>[] = [];
                for (const account of accounts) {
                    for (const chunk of chunks) {
                        requests.push(
                            this.getPerformanceTrades(chunk.start, chunk.end, account.name, account.id).pipe(
                                catchError(err => {
                                    if (this.isAuthError(err)) return throwError(() => err);
                                    console.error(`[TradovateService] getAllTrades failed for ${account.name}:`, err);
                                    return of([] as any[]);
                                })
                            )
                        );
                    }
                }

                return from(requests).pipe(
                    concatMap(req$ => req$),
                    reduce((all, chunk) => [...all, ...chunk], [] as any[])
                );
            }),
            catchError(err => {
                if (this.isAuthError(err)) return throwError(() => err);
                console.warn('[TradovateService] getAllTrades failed:', err);
                return of([] as any[]);
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
    private parseFillsCsv(csv: string, accountId: number): any[] {
        const lines = csv.split('\n').filter(l => l.trim().length > 0);
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const map: any = {};
        headers.forEach((h, i) => map[h] = i);
        // Helper to get value by column name
        const getVal = (row: string[], colName: string) => {
            const idx = map[colName];
            if (idx === undefined) return '';
            return row[idx]?.replace(/"/g, '') || '';
        };

        const fills: any[] = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(',');
            if (row.length < headers.length) continue;

            const fill: any = {
                id: getVal(row, 'Fill ID') || getVal(row, 'ID') || `csv-${i}`,
                orderId: parseInt(getVal(row, 'Order ID') || '0'),
                symbol: getVal(row, 'Contract') || getVal(row, 'Symbol'),
                action: (getVal(row, 'B/S') || getVal(row, 'Side') || '').toLowerCase().includes('b') ? 'Buy' : 'Sell',
                qty: parseFloat(getVal(row, 'Quantity') || getVal(row, 'Qty') || '0'),
                price: parseFloat(getVal(row, 'Price') || '0'),
                timestamp: getVal(row, 'Timestamp') || getVal(row, 'Date'),
                accountId: accountId
            };

            // Normalize timestamp
            if (fill.timestamp && !fill.timestamp.includes('T')) {
                try { fill.timestamp = new Date(fill.timestamp).toISOString(); } catch (e) { }
            }
            if (fill.id) fills.push(fill);
        }
        return fills;
    }
}
