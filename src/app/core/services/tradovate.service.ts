import { Injectable, signal, computed } from '@angular/core';
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
     * Parse CSV response data into fills array
     */
    private parseReportCsvResponse(csv: string, accountId: number): any[] {
        if (!csv || csv.trim().length === 0 || csv.trim() === '\r\n') {
            return [];
        }
        return this.parseFillsCsv(csv, accountId);
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
            switchMap(() => this.http.post<any>(url, body, { headers })),
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
    getHistoricalReportsAPI(startDate: Date, endDate?: Date, accountId?: number): Observable<any[]> {
        try {
            this.requireToken();
        } catch (e) {
            return throwError(() => e);
        }

        const end = endDate || new Date();
        const url = `${this.getRptUrl()}/reports/requestreport`;

        const body: any = {
            name: 'Fills',
            timezone: 0,
            params: [
                { name: 'startDate', value: this.formatDateForReport(startDate) },
                { name: 'endDate', value: this.formatDateForReport(end) }
            ],
            representationType: 'csv'
        };

        if (accountId) {
            body.params.push({ name: 'account', value: accountId.toString() });
        }

        console.log(`[TradovateService] Requesting Fills report for account ${accountId}:`,
            `${startDate.toISOString()} → ${end.toISOString()}`);

        const headers = this.getAuthHeaders().set('Content-Type', 'application/json');

        // Use responseType: 'text' because Tradovate sometimes returns raw CSV
        // instead of a JSON-wrapped response, which would cause a JSON parse error.
        return this.http.post(url, body, { headers, responseType: 'text' }).pipe(
            map((raw: string) => {
                try {
                    return JSON.parse(raw);
                } catch {
                    // Raw CSV response — wrap it so handleReportResponse can process it
                    return { data: raw };
                }
            }),
            switchMap((res: any) => this.handleReportResponse(res, url, body, accountId || 0)),
            catchError(err => this.handleReportError(err, accountId))
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
            console.warn(`[TradovateService] Report API error: ${res.errorText}`);
            return of([]);
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
     * Normalize raw fill data to TradovateFill interface
     */
    private normalizeFill(f: any, accountId: number): TradovateFill {
        return {
            id: f.id || f.fillId || `fill-${Math.random()}`,
            symbol: f.contract || f.symbol,
            action: ((f.action || f.side || '').toLowerCase().includes('buy') ? 'Buy' : 'Sell') as 'Buy' | 'Sell',
            qty: f.qty || f.quantity,
            price: f.price,
            timestamp: f.timestamp || f.time,
            orderId: f.orderId,
            contractId: f.contractId,
            accountId
        };
    }

    /**
     * Get effective start date for an account (uses account creation time if available)
     * If requestedStart is null, uses account timestamp (for full sync)
     * Otherwise returns the LATER of account creation date and requested start date
     */
    private getEffectiveStartDate(account: any, requestedStart: Date | null): Date {
        const accountStart = account.timestamp ? new Date(account.timestamp) : new Date(2020, 0, 1);

        if (!requestedStart) {
            // Full sync - use account creation date
            return accountStart;
        }

        // Use the later date - no point fetching fills before account existed
        return accountStart > requestedStart ? accountStart : requestedStart;
    }

    /**
     * Get all fills (current + historical) for a date range.
     * Uses each account's timestamp from /account/list as the dynamic start date.
     * Splits into 3-month chunks to avoid Tradovate's "Too long range" limit.
     * @param startDate - Start date, or null to use each account's creation date
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
                const selectedIds = this.getSelectedAccountIds();
                const accountsToFetch = selectedIds.length > 0
                    ? accounts.filter((a: any) => selectedIds.includes(a.id))
                    : accounts;

                if (accountsToFetch.length === 0) return of([]);

                const allRequests = this.buildFillRequests(accountsToFetch, startDate, end);
                console.log(`[TradovateService] Total requests: ${allRequests.length}`);

                return from(allRequests).pipe(
                    concatMap(req$ => req$),
                    reduce((all, chunk) => [...all, ...chunk], [] as TradovateFill[])
                );
            }),
            catchError(err => {
                console.error('Error fetching all fills:', err);
                return throwError(() => err);
            })
        );
    }

    /**
     * Build fill requests for all accounts, chunked by date range
     */
    private buildFillRequests(accounts: any[], startDate: Date | null, endDate: Date): Observable<TradovateFill[]>[] {
        const requests: Observable<TradovateFill[]>[] = [];

        for (const account of accounts) {
            const effectiveStart = this.getEffectiveStartDate(account, startDate);
            const chunks = this.chunkDateRange(effectiveStart, endDate, 3);

            console.log(`[TradovateService] Account ${account.name} (${account.id}): ${chunks.length} chunk(s)`);

            for (const chunk of chunks) {
                requests.push(
                    this.getHistoricalReportsAPI(chunk.start, chunk.end, account.id).pipe(
                        map(report => {
                            if (!Array.isArray(report)) return [];
                            return report.map(f => this.normalizeFill(f, account.id));
                        }),
                        catchError(err => {
                            console.warn(`[TradovateService] Failed chunk for account ${account.id}:`, err);
                            return of([]);
                        })
                    )
                );
            }
        }

        return requests;
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
