import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

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

    constructor(private http: HttpClient) { }

    private getConfig(): any | null {
        const config = localStorage.getItem('tradovate_config');
        return config ? JSON.parse(config) : null;
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
    simpleLogin(username: string, password: string): Observable<any> {
        const config = this.getConfig();
        if (!config) return throwError(() => new Error('Tradovate configuration not found'));

        const body = {
            locale: 'en',
            login: username,
            password: password
        };

        const authUrl = config.environment === 'live'
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
                    localStorage.setItem('tradovate_token', accessToken);
                    return res;
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
        const token = localStorage.getItem('tradovate_token');
        if (!token) return throwError(() => new Error('Tradovate not connected: Token missing from storage'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/account/list`, { headers });
    }


    getContract(contractId: number): Observable<any> {
        const token = localStorage.getItem('tradovate_token');
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
        const token = localStorage.getItem('tradovate_token');
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
        const token = localStorage.getItem('tradovate_token');
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/cashBalance/list`, { headers });
    }

    // Get cash balance for a specific account
    getCashBalanceForAccount(accountId: number): Observable<any> {
        const token = localStorage.getItem('tradovate_token');
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

    // Account selection management (localStorage)
    getSelectedAccountIds(): number[] {
        const stored = localStorage.getItem('tradovate_selected_accounts');
        return stored ? JSON.parse(stored) : [];
    }

    setSelectedAccountIds(accountIds: number[]): void {
        localStorage.setItem('tradovate_selected_accounts', JSON.stringify(accountIds));
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
        const token = localStorage.getItem('tradovate_token');
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/order/list`, { headers });
    }

    getMarketData(symbol: string, timeframe: string = '15min', barsCount: number = 100): Promise<any> {
        const token = localStorage.getItem('tradovate_token');
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
        const token = localStorage.getItem('tradovate_token');
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

        console.log(`[TradovateService] Fetching historical fills report from ${params.startDate} to ${params.endDate}`);

        // Use the Reports API endpoint for fill reports
        return this.http.get(`${this.getRptUrl()}/fillReport/item`, { headers, params }).pipe(
            catchError(err => {
                console.error('Error fetching historical fills report:', err);
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
