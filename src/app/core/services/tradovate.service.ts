import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of, timer, from, forkJoin } from 'rxjs';
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

    // Computed values
    activeConnection = computed(() => {
        const connId = this.activeConnectionId();
        if (!connId) return null;
        return this.connections().find(c => c.id === connId) || null;
    });

    isConnected = computed(() => this.activeConnection() !== null);

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
            this.accounts.set([]); // Invalidate cache on connection switch
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
     * Execute an authenticated GET request
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
        });
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
                    return this.pollWithPTicket(url, body, res['p-ticket'], waitMs, accountId, attempt + 1);
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
            const waitMs = (res['p-time'] || 2) * 1000;
            return this.pollWithPTicket(url, body, pTicket, waitMs, accountId);
        }

        // Error response
        if (res.errorText) {
            return throwError(() => new Error(`Report API: ${res.errorText}`));
        }

        console.warn('[TradovateService] Unexpected response format:', res);
        return of([]);
    }

    /**
     * Handle errors in report fetching with fallback to /fill/list
     */
    private handleReportError(err: any, accountId?: number): Observable<any[]> {
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

        return timer(1000, 2000).pipe(
            mergeMap(() => this.http.get<any>(
                `${this.getRptUrl()}/reports/pollreportstatus?reportId=${reportId}`,
                { headers: this.getAuthHeaders() }
            )),
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
     * Tier 1: fetch today's fills via /fill/list + /order/list join.
     * /fill/list only returns current-session fills but has real fill IDs.
     * /order/list provides the accountId per order (joined via fill.orderId).
     */
    private buildTodayFills(end: Date): Observable<TradovateFill[]> {
        const fills$ = this.authGet<any[]>('/fill/list');
        const orders$ = this.authGet<any[]>('/order/list').pipe(catchError(() => of([])));

        return fills$.pipe(
            switchMap(fills => {
                if (!Array.isArray(fills)) {
                    console.warn('[TradovateService] /fill/list did not return an array:', fills);
                    return of([]);
                }
                console.log(`[TradovateService] /fill/list returned ${fills.length} fill(s)`);

                // Resolve unique contractIds → symbol names via /contract/item
                const uniqueContractIds = [...new Set(
                    fills.map(f => f.contractId).filter((id): id is number => !!id)
                )];
                const contracts$ = uniqueContractIds.length
                    ? forkJoin(uniqueContractIds.map(id =>
                          this.authGet<any>('/contract/item', { id: id.toString() }).pipe(catchError(() => of(null)))
                      ))
                    : of([] as any[]);

                return forkJoin([orders$, contracts$]).pipe(
                    map(([orders, contracts]) => {
                        const orderAccountMap = new Map<number, number>();
                        if (Array.isArray(orders)) {
                            orders.forEach(o => {
                                if (o.id && o.accountId) orderAccountMap.set(o.id, o.accountId);
                            });
                        }

                        // contractId → symbol name (e.g. 12345 → "ESH5")
                        const contractNameMap = new Map<number, string>();
                        if (Array.isArray(contracts)) {
                            contracts.forEach((c: any) => {
                                if (c?.id && c?.name) contractNameMap.set(c.id, c.name);
                            });
                        }

                        return fills
                            .filter(f => {
                                const ts = f.timestamp || f.time;
                                if (!ts) return false;
                                return new Date(ts) <= end;
                            })
                            .map(f => {
                                const accountId = orderAccountMap.get(f.orderId) || 0;
                                const symbol = contractNameMap.get(f.contractId) || '';
                                return this.normalizeFill({ ...f, symbol }, accountId);
                            });
                    })
                );
            }),
            catchError(err => {
                console.warn('[TradovateService] /fill/list failed:', err);
                return of([] as TradovateFill[]);
            })
        );
    }

    /**
     * Get all fills enriched with accountId using a two-tier approach:
     *   Tier 1 — /fill/list + /order/list: today's fills (fast, reliable accountId join)
     *   Tier 2 — Reports API (one request, all accounts): historical fills before today
     *            Account IDs are resolved by matching the "Account" name column in the
     *            HTML response to the accounts fetched from /account/list.
     * Results are merged and deduplicated by fill ID (Tier 1 takes precedence).
     */
    getAllFills(startDate: Date | null, endDate?: Date): Observable<TradovateFill[]> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        const end = endDate || new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0); // midnight local — start of today

        console.log(`[TradovateService] getAllFills: ${startDate?.toISOString() ?? 'account start'} → ${end.toISOString()}`);

        const tier1$ = this.buildTodayFills(end);

        // Tier 2 only needed when startDate is before today (or full sync with no startDate)
        const needsHistory = !startDate || startDate < today;
        const yesterday = new Date(today.getTime() - 1); // 1ms before midnight = end of yesterday

        const tier2$: Observable<TradovateFill[]> = needsHistory
            ? this.getAccounts().pipe(
                switchMap(accounts => {
                    if (accounts.length === 0) return of([] as TradovateFill[]);

                    // Use earliest account creation date as the effective start
                    const effectiveStart = startDate ?? accounts.reduce<Date>((earliest, a) => {
                        const ts = a.timestamp ? new Date(a.timestamp) : new Date(2020, 0, 1);
                        return ts < earliest ? ts : earliest;
                    }, new Date());

                    const chunks = this.chunkDateRange(effectiveStart, yesterday, 1);
                    console.log(`[TradovateService] Tier 2: ${chunks.length} chunk(s) × ${accounts.length} account(s) via Reports API`);

                    // One request per account per chunk — pass account name as the API expects
                    console.log(`[TradovateService] Accounts for Reports API:`, accounts.map(a => `${a.name} (id:${a.id})`));
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
                    console.warn('[TradovateService] Tier 2 (Reports API) failed — proceeding with today-only fills:', err);
                    return of([] as TradovateFill[]);
                })
            )
            : of([] as TradovateFill[]);

        return forkJoin([tier1$, tier2$]).pipe(
            map(([tier1Fills, tier2Fills]) => {
                // Tier 1 wins on duplicates (has accurate accountId from order join)
                const tier1Ids = new Set(tier1Fills.map(f => String(f.id)));
                const uniqueTier2 = tier2Fills.filter(f => !tier1Ids.has(String(f.id)));
                const merged = [...tier1Fills, ...uniqueTier2];
                console.log(
                    `[TradovateService] Merged: ${tier1Fills.length} today + ${uniqueTier2.length} historical = ${merged.length} total fills`
                );
                return merged;
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
