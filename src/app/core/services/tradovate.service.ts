import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Observable, from, of, throwError } from 'rxjs';

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
    private baseUrl = 'https://live.tradovateapi.com/v1'; // Or demo url
    private accessToken: string | null = null;

    constructor(private http: HttpClient) { }

    private getConfig(): TradovateConfig | null {
        const config = localStorage.getItem('tradovate_config');
        return config ? JSON.parse(config) : null;
    }

    // Authenticate and get Access Token
    // Note: In a real prod client-side app, this is insecure/hard due to CORS.
    // We assume for this prototype that the user understands the limitations.
    authenticate(): Observable<string> {
        const config = this.getConfig();
        if (!config) return throwError(() => new Error('No configuration found'));

        // Basic Access Token Request (This structure varies by auth type, using standard assumption)
        // Tradovate generic auth often requires body: { name, password, appId, ... }
        // For API Key access, it might be different. 
        // We will try a hypothetical direct token request for this scaffold.

        // Mocking the auth for now as we don't have a real endpoint without concrete docs on "API Key" specific flow
        // In reality, you'd likely hit /auth/accesstokenrequest

        console.log('Authenticating with Tradovate (Mock)...');
        // Simulate a delay and return a fake token
        return new Observable(observer => {
            setTimeout(() => {
                this.accessToken = 'mock-access-token';
                observer.next(this.accessToken);
                observer.complete();
            }, 1000);
        });
    }

    getFills(fromDate: Date): Observable<TradovateFill[]> {
        if (!this.accessToken) {
            return this.authenticate().pipe(
                switchMap(() => this.getFills(fromDate))
            );
        }

        // Mocking Fill Data for MVP until we can verify the exact endpoint
        // A real endpoint would be POST /fill/list with { from: ... }

        console.log(`Fetching fills from ${fromDate.toISOString()}`);
        return of([
            {
                id: 1001,
                symbol: 'ESZ4',
                side: 'Buy',
                qty: 1,
                price: 4500.25,
                timestamp: new Date().toISOString(),
                fee: 2.50
            },
            {
                id: 1002,
                symbol: 'ESZ4',
                side: 'Sell',
                qty: 1,
                price: 4510.50,
                timestamp: new Date().toISOString(),
                fee: 2.50
            }
        ]);
    }
}
