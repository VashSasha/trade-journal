import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

export interface TradovateConfig {
    apiKey: string; // CID
    apiSecret: string;
}

export interface TradovateFill {
    id: number;
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: number;
    price: number;
    timestamp: string;
    fee: number;
}

@Injectable({
    providedIn: 'root'
})
export class TradovateService {
    private liveBaseUrl = 'https://live.tradovateapi.com/v1';
    private demoBaseUrl = 'https://demo.tradovateapi.com/v1';
    private demoAuthUrl = 'https://demo.tradovateapi.com/v1/auth'; // Different path for direct login

    constructor(private http: HttpClient) { }

    private getConfig(): any | null {
        const config = localStorage.getItem('tradovate_config');
        return config ? JSON.parse(config) : null;
    }

    private getBaseUrl(): string {
        const config = this.getConfig();
        return config?.environment === 'live' ? this.liveBaseUrl : this.demoBaseUrl;
    }

    // Exchange OAuth code for an access token (Live/Funded)
    exchangeCodeForToken(code: string): Observable<any> {
        const config = this.getConfig();
        if (!config) return throwError(() => new Error('Tradovate configuration not found'));

        const body = {
            grant_type: 'authorization_code',
            code,
            client_id: config.apiKey,
            client_secret: config.apiSecret,
            redirect_uri: window.location.origin + '/settings/tradovate/callback'
        };

        return this.http.post(`https://live.tradovateapi.com/auth/oauthtoken`, body).pipe(
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

    // Direct Login (Demo/Free) using Username/Password
    directLogin(credentials: any): Observable<any> {
        const body = {
            name: credentials.username,
            password: credentials.password,
            appId: 'Sample App',
            appVersion: '1.0',
            cid: 8, // Default CID for Sample App
            deviceId: '9e726d97-b2ad-4cbe-8ba8-21258268ec15', // Static for this app
            sec: 'f03741b6-f634-48d6-9308-c8fb871150c2d' // Default Secret for Sample App
        };

        return this.http.post(`${this.demoAuthUrl}/accesstokenrequest`, body).pipe(
            map((res: any) => {
                if (res.accessToken) {
                    localStorage.setItem('tradovate_token', res.accessToken);
                    return res;
                } else if (res.errorText) {
                    throw new Error(res.errorText);
                } else {
                    throw new Error('Login failed: No access token received');
                }
            })
        );
    }

    getFills(fromDate: Date): Observable<TradovateFill[]> {
        const token = localStorage.getItem('tradovate_token');
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/fill/list`, { headers }).pipe(
            map(fills => fills.map(f => ({
                id: f.id,
                symbol: f.contractId?.toString() || 'Unknown',
                side: f.side,
                qty: f.qty,
                price: f.price,
                timestamp: f.timestamp,
                fee: f.fee || 0
            })))
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

    getCashBalances(): Observable<any[]> {
        const token = localStorage.getItem('tradovate_token');
        if (!token) return throwError(() => new Error('Tradovate not connected'));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        });

        return this.http.get<any[]>(`${this.getBaseUrl()}/cashBalance/list`, { headers });
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
}
