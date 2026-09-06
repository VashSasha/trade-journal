import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserSessionService } from '../../core/services/user-session.service';
import {
    MARKET_HEADLINE_SOURCES, MarketHeadline, MarketHeadlineSource, parseMarketHeadlines,
} from './market-news.models';

export type MarketNewsStatus = 'idle' | 'loading' | 'live' | 'partial' | 'stale' | 'error';

interface MarketNewsResponse {
    headlines: unknown;
    fetchedAt: unknown;
    unavailableSources: unknown;
}

interface MarketNewsCache {
    savedAt: number;
    fetchedAt: string;
    headlines: MarketHeadline[];
    unavailableSources: MarketHeadlineSource[];
}

const CACHE_KEY = 'nvzn_market_news_v1';
const REFRESH_MS = 15 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class MarketNewsService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly document = inject(DOCUMENT);
    private readonly view = this.document.defaultView;
    readonly headlines = signal<MarketHeadline[]>([]);
    readonly status = signal<MarketNewsStatus>('idle');
    readonly error = signal<string | null>(null);
    readonly fetchedAt = signal<string | null>(null);
    readonly unavailableSources = signal<MarketHeadlineSource[]>([]);
    readonly refreshing = signal(false);
    private request: Promise<void> | null = null;
    private requestOwner: string | null = null;

    constructor() {
        this.restoreCache();
    }

    refresh(force = false): Promise<void> {
        const owner = this.session.userId();
        if (!owner) {
            return this.session.ready.then(() => this.session.userId() ? this.refresh(force) : undefined);
        }
        if (this.request && this.requestOwner === owner) return this.request;
        if (!force && this.fetchedAt()) {
            const age = Date.now() - Date.parse(this.fetchedAt()!);
            if (Number.isFinite(age) && age < REFRESH_MS) return Promise.resolve();
        }

        this.requestOwner = owner;
        this.refreshing.set(true);
        if (!this.headlines().length) this.status.set('loading');
        const operation = this.session.capture();
        this.request = this.client.functions.invoke<MarketNewsResponse>('market-news', {
            body: { limit: 40 },
            signal: operation.signal,
        }).then(({ data, error }) => {
            if (!this.session.isCurrent(operation)) return;
            if (error || !data) throw error ?? new Error('No market-news response');
            const headlines = parseMarketHeadlines(data.headlines);
            if (!headlines.length) throw new Error('Official feeds returned no supported headlines');
            const fetchedAt = typeof data.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt))
                ? new Date(data.fetchedAt).toISOString()
                : new Date().toISOString();
            const unavailableSources = this.parseUnavailableSources(data.unavailableSources);
            this.headlines.set(headlines);
            this.fetchedAt.set(fetchedAt);
            this.unavailableSources.set(unavailableSources);
            this.error.set(null);
            this.status.set(unavailableSources.length ? 'partial' : 'live');
            this.saveCache({ savedAt: Date.now(), fetchedAt, headlines, unavailableSources });
        }).catch(() => {
            if (!this.session.isCurrent(operation)) return;
            this.error.set(this.headlines().length
                ? 'Latest headlines could not be refreshed. Showing the last saved feed.'
                : 'Official market headlines are temporarily unavailable.');
            this.status.set(this.headlines().length ? 'stale' : 'error');
        }).finally(() => {
            if (this.requestOwner === owner) {
                this.request = null;
                this.requestOwner = null;
                this.refreshing.set(false);
            }
        });
        return this.request;
    }

    private parseUnavailableSources(value: unknown): MarketHeadlineSource[] {
        if (!Array.isArray(value)) return [];
        const allowed = new Set(MARKET_HEADLINE_SOURCES);
        return [...new Set(value.filter((source): source is MarketHeadlineSource =>
            typeof source === 'string' && allowed.has(source as MarketHeadlineSource)))];
    }

    private restoreCache(): void {
        try {
            const raw = this.view?.localStorage.getItem(CACHE_KEY);
            if (!raw) return;
            const cache = JSON.parse(raw) as Partial<MarketNewsCache>;
            if (!Number.isFinite(cache.savedAt) || Date.now() - cache.savedAt! > CACHE_MAX_AGE_MS) {
                this.view?.localStorage.removeItem(CACHE_KEY);
                return;
            }
            const headlines = parseMarketHeadlines(cache.headlines);
            if (!headlines.length) return;
            this.headlines.set(headlines);
            this.fetchedAt.set(typeof cache.fetchedAt === 'string' ? cache.fetchedAt : null);
            this.unavailableSources.set(this.parseUnavailableSources(cache.unavailableSources));
            this.status.set('stale');
        } catch {
            this.view?.localStorage.removeItem(CACHE_KEY);
        }
    }

    private saveCache(cache: MarketNewsCache): void {
        try { this.view?.localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
        catch { /* The in-memory feed remains usable for this tab. */ }
    }
}
