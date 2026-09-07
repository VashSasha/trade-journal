// Authenticated, provider-neutral market-event schedule assembled from
// official U.S. government sources. No third-party API key reaches the client.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { readJson, RequestError } from '../_shared/request-body.ts';

type Impact = 'high' | 'medium';
type Source = 'bls' | 'bea' | 'federal-reserve';

interface MarketEvent {
    id: string;
    title: string;
    abbr: string;
    country: 'US';
    startsAt: string;
    impact: Impact;
    source: Source;
    sourceName: string;
    sourceUrl: string;
    estimated: boolean;
}

interface EventDefinition {
    match: RegExp;
    abbr: string;
    impact: Impact;
}

const BLS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
const BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json';
const FED_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const MAX_RANGE_MS = 550 * 24 * 60 * 60 * 1000;

const BLS_EVENTS: EventDefinition[] = [
    { match: /^Employment Situation/i, abbr: 'NFP', impact: 'high' },
    { match: /^Consumer Price Index/i, abbr: 'CPI', impact: 'high' },
    { match: /^Producer Price Index/i, abbr: 'PPI', impact: 'high' },
    { match: /^Job Openings and Labor Turnover Survey/i, abbr: 'JOLTS', impact: 'medium' },
    { match: /^Employment Cost Index/i, abbr: 'ECI', impact: 'medium' },
    { match: /^Productivity and Costs/i, abbr: 'PRODUCTIVITY', impact: 'medium' },
    { match: /^U\.S\. Import and Export Price Indexes/i, abbr: 'IMPORTS', impact: 'medium' },
];

const BEA_EVENTS: EventDefinition[] = [
    { match: /^Gross Domestic Product$/i, abbr: 'GDP', impact: 'high' },
    { match: /^Personal Income and Outlays$/i, abbr: 'PCE', impact: 'high' },
    { match: /^U\.S\. International Trade in Goods and Services$/i, abbr: 'TRADE', impact: 'medium' },
];

// Decision days from the Federal Reserve's published meeting calendar.
// The page remains the source of truth; keeping these small annual lists local
// makes the fallback deterministic if the source page changes its markup.
const FOMC_DATES = [
    '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
    '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
    '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
    '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
    '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09',
    '2027-07-28', '2027-09-15', '2027-10-28', '2027-12-08',
] as const;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]),
    }) },
});
const allowed = new Set(['http://localhost:4200', Deno.env.get('APP_ORIGIN') ?? ''].filter(Boolean));
const pagesOrigin = /^https:\/\/(?:[a-z0-9-]+\.)?trade-journal-2go\.pages\.dev$/i;

function dateOnly(value: unknown, fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new RequestError('Dates must use YYYY-MM-DD.', 400);
    }
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
        throw new RequestError('Invalid calendar date.', 400);
    }
    return value;
}

function utcDate(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function partsAt(timestamp: number, timeZone: string): number[] {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(timestamp);
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
    return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}

/** Convert a wall-clock value in an IANA zone to an unambiguous UTC instant. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = target;
    for (let pass = 0; pass < 2; pass++) {
        const actual = partsAt(guess, 'America/New_York');
        const represented = Date.UTC(actual[0], actual[1] - 1, actual[2], actual[3], actual[4], actual[5]);
        guess += target - represented;
    }
    return guess;
}

function parseIcsTimestamp(value: string, property: string): number | null {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!match) return null;
    const [, y, m, d, h, min, sec = '00', zulu] = match;
    if (zulu) return Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
    const zone = property.match(/TZID=([^;:]+)/i)?.[1];
    if (zone && !['US-Eastern', 'America/New_York'].includes(zone)) return null;
    return zonedToUtc(+y, +m, +d, +h, +min, +sec);
}

function unescapeIcs(value: string): string {
    return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

function icsValue(block: string, field: string): { property: string; value: string } | null {
    const line = block.split('\n').find(candidate => {
        const property = candidate.slice(0, candidate.indexOf(':'));
        return property === field || property.startsWith(`${field};`);
    });
    if (!line) return null;
    const separator = line.indexOf(':');
    return { property: line.slice(0, separator), value: line.slice(separator + 1) };
}

function parseBls(text: string, from: number, to: number): MarketEvent[] {
    const unfolded = text.replace(/\r?\n[ \t]/g, '').replace(/\r/g, '');
    const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)].map(match => match[1]);
    const events: MarketEvent[] = [];
    for (const block of blocks) {
        const summary = icsValue(block, 'SUMMARY');
        const start = icsValue(block, 'DTSTART');
        if (!summary || !start) continue;
        const title = unescapeIcs(summary.value);
        const definition = BLS_EVENTS.find(candidate => candidate.match.test(title));
        const timestamp = parseIcsTimestamp(start.value, start.property);
        if (!definition || timestamp === null || timestamp < from || timestamp > to) continue;
        const uid = icsValue(block, 'UID')?.value ?? `${definition.abbr}:${timestamp}`;
        events.push({
            id: `bls:${uid}`, title, abbr: definition.abbr, country: 'US',
            startsAt: new Date(timestamp).toISOString(), impact: definition.impact,
            source: 'bls', sourceName: 'U.S. Bureau of Labor Statistics', sourceUrl: BLS_URL,
            estimated: false,
        });
    }
    return events;
}

function parseBea(value: unknown, from: number, to: number): MarketEvent[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected BEA response');
    const calendar = value as Record<string, unknown>;
    const events: MarketEvent[] = [];
    for (const definition of BEA_EVENTS) {
        const title = Object.keys(calendar).find(key => definition.match.test(key));
        if (!title) continue;
        const entry = calendar[title];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const dates = (entry as { release_dates?: unknown }).release_dates;
        if (!Array.isArray(dates)) continue;
        for (const raw of dates) {
            if (typeof raw !== 'string') continue;
            const timestamp = Date.parse(raw);
            if (!Number.isFinite(timestamp) || timestamp < from || timestamp > to) continue;
            events.push({
                id: `bea:${definition.abbr}:${new Date(timestamp).toISOString()}`,
                title, abbr: definition.abbr, country: 'US', startsAt: new Date(timestamp).toISOString(),
                impact: definition.impact, source: 'bea', sourceName: 'U.S. Bureau of Economic Analysis',
                sourceUrl: 'https://www.bea.gov/news/schedule', estimated: false,
            });
        }
    }
    return events;
}

function fomcEvents(from: number, to: number): MarketEvent[] {
    return FOMC_DATES.flatMap(date => {
        const [year, month, day] = date.split('-').map(Number);
        const timestamp = zonedToUtc(year, month, day, 14, 0);
        return timestamp < from || timestamp > to ? [] : [{
            id: `federal-reserve:FOMC:${date}`, title: 'FOMC Rate Decision', abbr: 'FOMC' as const,
            country: 'US' as const, startsAt: new Date(timestamp).toISOString(), impact: 'high' as const,
            source: 'federal-reserve' as const, sourceName: 'Federal Reserve Board',
            sourceUrl: FED_URL, estimated: false,
        }];
    });
}

function uniqueSorted(events: MarketEvent[]): MarketEvent[] {
    const unique = new Map<string, MarketEvent>();
    for (const event of events) unique.set(`${event.abbr}:${event.startsAt}`, event);
    return [...unique.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}

Deno.serve(async req => {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = origin && (allowed.has(origin) || pagesOrigin.test(origin)) ? {
        'Access-Control-Allow-Origin': origin, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    } : {};
    const json = (body: unknown, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
        status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache },
    });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    try {
        const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        if (!jwt) return json({ error: 'Missing Authorization header' }, 401);
        const auth = await admin.auth.getUser(jwt);
        if (auth.error || !auth.data.user) return json({ error: 'Invalid or expired token' }, 401);

        const body = await readJson(req, 4096) as { from?: unknown; to?: unknown } | null;
        const today = Date.now();
        const fromDate = dateOnly(body?.from, utcDate(today - 90 * 86_400_000));
        const toDate = dateOnly(body?.to, utcDate(today + 370 * 86_400_000));
        const from = Date.parse(`${fromDate}T00:00:00Z`);
        const to = Date.parse(`${toDate}T23:59:59.999Z`);
        if (to < from || to - from > MAX_RANGE_MS) throw new RequestError('Date range is too large.', 400);

        const signal = AbortSignal.any([req.signal, AbortSignal.timeout(12_000)]);
        const [blsResult, beaResult] = await Promise.allSettled([
            fetch(BLS_URL, {
                signal,
                headers: { 'User-Agent': 'NVZN-Journal/1.0 (economic calendar; https://nvzn-journal.com)' },
            }).then(async response => {
                if (!response.ok) throw new Error(`BLS ${response.status}`);
                return parseBls(await response.text(), from, to);
            }),
            fetch(BEA_URL, {
                signal,
                headers: { 'User-Agent': 'NVZN-Journal/1.0 (economic calendar; https://nvzn-journal.com)' },
            }).then(async response => {
                if (!response.ok) throw new Error(`BEA ${response.status}`);
                return parseBea(await response.json(), from, to);
            }),
        ]);

        const unavailableSources: Source[] = [];
        const events = [...fomcEvents(from, to)];
        if (blsResult.status === 'fulfilled') events.push(...blsResult.value);
        else unavailableSources.push('bls');
        if (beaResult.status === 'fulfilled') events.push(...beaResult.value);
        else unavailableSources.push('bea');

        return json({
            events: uniqueSorted(events),
            fetchedAt: new Date().toISOString(),
            unavailableSources,
        }, 200, 'private, max-age=900, stale-while-revalidate=21600');
    } catch (error) {
        const status = error instanceof RequestError ? error.status : 502;
        console.warn('Market event schedule failed', { status });
        return json({ error: error instanceof RequestError ? error.message : 'Official event schedules are temporarily unavailable.' }, status);
    }
});
