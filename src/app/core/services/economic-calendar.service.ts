import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserSessionService } from './user-session.service';
import {
    EconomicEvent, economicEventTimestamp, getEconomicEventsForMonth,
} from '../utils/economic-events';

export type { EconomicEvent };

export type EconomicCalendarStatus = 'idle' | 'loading' | 'live' | 'stale' | 'fallback';

interface MarketEventWire {
    id: string;
    title: string;
    abbr: string;
    country: string;
    startsAt: string;
    impact: 'high' | 'medium';
    source: 'bls' | 'bea' | 'federal-reserve';
    sourceName: string;
    sourceUrl: string;
    estimated: boolean;
}

interface MarketEventsResponse {
    events: MarketEventWire[];
    fetchedAt: string;
    unavailableSources: string[];
}

interface CalendarCache {
    savedAt: number;
    fetchedAt: string;
    events: EconomicEvent[];
    unavailableSources: string[];
}

const CACHE_KEY = 'nvzn_market_events_v1';
const REFRESH_MS = 30 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class EconomicCalendarService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly view = this.document.defaultView;
    private readonly officialEvents = signal<EconomicEvent[]>([]);
    readonly status = signal<EconomicCalendarStatus>('idle');
    readonly error = signal<string | null>(null);
    readonly fetchedAt = signal<string | null>(null);
    readonly unavailableSources = signal<string[]>([]);
    readonly refreshing = signal(false);
    readonly hasOfficialSchedule = computed(() => this.officialEvents().length > 0);
    private refreshTimer: number | undefined;
    private request: Promise<void> | null = null;
    private requestOwner: string | null = null;

    constructor() {
        this.restoreCache();
        effect(() => {
            const owner = this.session.userId();
            this.view?.clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
            if (!owner) return;
            void this.refresh();
            this.refreshTimer = this.view?.setInterval(() => void this.refresh(), REFRESH_MS);
        });
        this.destroyRef.onDestroy(() => this.view?.clearInterval(this.refreshTimer));
    }

    getEventsForMonth(year: number, month: number): EconomicEvent[] {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const official = this.officialEvents().filter(event => event.date.startsWith(monthKey));
        const officialKinds = new Set(official.map(event => `${event.abbr}:${monthKey}`));
        const fallback = getEconomicEventsForMonth(year, month)
            .filter(event => !officialKinds.has(`${event.abbr}:${monthKey}`));
        return [...fallback, ...official]
            .sort((a, b) => economicEventTimestamp(a) - economicEventTimestamp(b) || a.abbr.localeCompare(b.abbr));
    }

    getUpcomingEvents(now = Date.now(), through = now + 7 * DAY_MS): EconomicEvent[] {
        const months = new Set<string>();
        const cursor = new Date(now);
        cursor.setUTCDate(1);
        cursor.setUTCHours(12, 0, 0, 0);
        while (cursor.getTime() <= through + 32 * DAY_MS) {
            months.add(`${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}`);
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        const events = [...months].flatMap(key => {
            const [year, month] = key.split('-').map(Number);
            return this.getEventsForMonth(year, month);
        });
        return events.filter(event => {
            const at = economicEventTimestamp(event);
            return Number.isFinite(at) && at >= now && at <= through;
        }).sort((a, b) => economicEventTimestamp(a) - economicEventTimestamp(b) || a.abbr.localeCompare(b.abbr));
    }

    refresh(force = false): Promise<void> {
        const owner = this.session.userId();
        if (!owner) return Promise.resolve();
        if (this.request && this.requestOwner === owner) return this.request;
        if (!force && this.fetchedAt()) {
            const age = Date.now() - Date.parse(this.fetchedAt()!);
            if (Number.isFinite(age) && age < REFRESH_MS) return Promise.resolve();
        }
        this.requestOwner = owner;
        this.refreshing.set(true);
        if (!this.officialEvents().length) this.status.set('loading');
        const operation = this.session.capture();
        const now = Date.now();
        this.request = this.client.functions.invoke<MarketEventsResponse>('market-events', {
            body: {
                from: new Date(now - 90 * DAY_MS).toISOString().slice(0, 10),
                to: new Date(now + 370 * DAY_MS).toISOString().slice(0, 10),
            },
            signal: operation.signal,
        }).then(({ data, error }) => {
            if (!this.session.isCurrent(operation)) return;
            if (error || !data) throw error ?? new Error('No market-event response');
            const events = this.parseResponse(data.events);
            if (!events.length) throw new Error('Official schedules returned no supported events');
            this.officialEvents.set(events);
            this.fetchedAt.set(data.fetchedAt);
            this.unavailableSources.set(Array.isArray(data.unavailableSources) ? data.unavailableSources : []);
            this.error.set(null);
            this.status.set(this.unavailableSources().length ? 'stale' : 'live');
            this.saveCache({
                savedAt: Date.now(), fetchedAt: data.fetchedAt, events,
                unavailableSources: this.unavailableSources(),
            });
        }).catch(() => {
            if (!this.session.isCurrent(operation)) return;
            this.error.set('Live event schedules are unavailable. Showing the last known or reference calendar.');
            this.status.set(this.officialEvents().length ? 'stale' : 'fallback');
        }).finally(() => {
            if (this.requestOwner === owner) {
                this.request = null;
                this.requestOwner = null;
                this.refreshing.set(false);
            }
        });
        return this.request;
    }

    private parseResponse(value: unknown): EconomicEvent[] {
        if (!Array.isArray(value)) return [];
        const events: EconomicEvent[] = [];
        for (const candidate of value) {
            if (!candidate || typeof candidate !== 'object') continue;
            const event = candidate as Partial<MarketEventWire>;
            const timestamp = typeof event.startsAt === 'string' ? Date.parse(event.startsAt) : Number.NaN;
            if (!Number.isFinite(timestamp) || typeof event.id !== 'string' || typeof event.title !== 'string'
                || typeof event.abbr !== 'string' || !['high', 'medium'].includes(event.impact ?? '')
                || typeof event.sourceUrl !== 'string' || !/^https:\/\//.test(event.sourceUrl)) continue;
            const eastern = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
            }).formatToParts(timestamp);
            const part = (type: Intl.DateTimeFormatPartTypes) => eastern.find(item => item.type === type)?.value ?? '';
            events.push({
                id: event.id, event: event.title.slice(0, 160), abbr: event.abbr.slice(0, 20),
                date: `${part('year')}-${part('month')}-${part('day')}`,
                time: `${part('hour')}:${part('minute')}`, impact: event.impact!,
                link: event.sourceUrl, startsAt: new Date(timestamp).toISOString(),
                estimated: event.estimated === true, country: event.country?.slice(0, 8) || 'US',
                source: event.source, sourceName: event.sourceName?.slice(0, 80),
            });
        }
        return events;
    }

    private restoreCache(): void {
        try {
            const raw = this.view?.localStorage.getItem(CACHE_KEY);
            if (!raw) { this.status.set('fallback'); return; }
            const cache = JSON.parse(raw) as Partial<CalendarCache>;
            if (!Number.isFinite(cache.savedAt) || Date.now() - cache.savedAt! > CACHE_MAX_AGE_MS) {
                this.view?.localStorage.removeItem(CACHE_KEY);
                this.status.set('fallback');
                return;
            }
            const events = this.parseResponse(cache.events?.map(event => ({
                id: event.id, title: event.event, abbr: event.abbr, country: event.country,
                startsAt: event.startsAt, impact: event.impact, source: event.source,
                sourceName: event.sourceName, sourceUrl: event.link, estimated: event.estimated,
            })) ?? []);
            if (!events.length) { this.status.set('fallback'); return; }
            this.officialEvents.set(events);
            this.fetchedAt.set(typeof cache.fetchedAt === 'string' ? cache.fetchedAt : null);
            this.unavailableSources.set(Array.isArray(cache.unavailableSources) ? cache.unavailableSources : []);
            this.status.set('stale');
        } catch {
            this.status.set('fallback');
        }
    }

    private saveCache(cache: CalendarCache): void {
        try { this.view?.localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
        catch { /* The in-memory schedule remains usable for this tab. */ }
    }
}
