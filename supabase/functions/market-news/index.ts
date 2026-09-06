// Authenticated proxy for public, official U.S. market headlines. Keeping RSS
// fetching server-side avoids browser CORS failures and gives the UI one stable,
// normalized contract. No third-party news key is required.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { readJson, RequestError } from '../_shared/request-body.ts';
import {
    MarketFeedDefinition, MarketHeadline, MarketHeadlineSource, parseMarketFeed, uniqueNewest,
} from './rss.ts';

interface CachedFeed {
    expiresAt: number;
    fetchedAt: string;
    headlines: MarketHeadline[];
    unavailableSources: MarketHeadlineSource[];
}

const FEEDS: MarketFeedDefinition[] = [
    {
        source: 'federal-reserve', sourceName: 'Federal Reserve Board', category: 'monetary-policy',
        url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
        hostname: 'www.federalreserve.gov', format: 'rss',
    },
    {
        source: 'bls-cpi', sourceName: 'U.S. Bureau of Labor Statistics', category: 'inflation',
        url: 'https://www.bls.gov/feed/cpi.rss', hostname: 'www.bls.gov', format: 'atom',
    },
    {
        source: 'bls-employment', sourceName: 'U.S. Bureau of Labor Statistics', category: 'employment',
        url: 'https://www.bls.gov/feed/empsit.rss', hostname: 'www.bls.gov', format: 'atom',
    },
    {
        source: 'bls-ppi', sourceName: 'U.S. Bureau of Labor Statistics', category: 'inflation',
        url: 'https://www.bls.gov/feed/ppi.rss', hostname: 'www.bls.gov', format: 'atom',
    },
];
const MEMORY_CACHE_MS = 5 * 60 * 1000;
const MAX_HEADLINES = 40;
let memoryCache: CachedFeed | null = null;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]),
    }) },
});
const allowed = new Set(['http://localhost:4200', Deno.env.get('APP_ORIGIN') ?? ''].filter(Boolean));

function isAllowedOrigin(origin: string | null): origin is string {
    if (!origin) return false;
    return allowed.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?trade-journal-2go\.pages\.dev$/i.test(origin);
}

function requestedLimit(value: unknown): number {
    if (value === undefined) return 30;
    if (!Number.isInteger(value) || Number(value) < 5 || Number(value) > MAX_HEADLINES) {
        throw new RequestError(`limit must be an integer between 5 and ${MAX_HEADLINES}.`, 400);
    }
    return Number(value);
}

async function fetchFeed(definition: MarketFeedDefinition, signal: AbortSignal): Promise<MarketHeadline[]> {
    const response = await fetch(definition.url, {
        signal,
        headers: {
            Accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
            'User-Agent': 'NVZN-Journal/1.0 (market headlines; https://nvzn-journal.com)',
        },
    });
    if (!response.ok) throw new Error(`${definition.source} returned ${response.status}`);
    const headlines = parseMarketFeed(await response.text(), definition);
    if (!headlines.length) throw new Error(`${definition.source} returned no usable headlines`);
    return headlines;
}

Deno.serve(async req => {
    const origin = req.headers.get('Origin');
    const cors: Record<string, string> = isAllowedOrigin(origin) ? {
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

        const body = await readJson(req, 2_048) as { limit?: unknown } | null;
        const limit = requestedLimit(body?.limit);
        const now = Date.now();
        if (!memoryCache || memoryCache.expiresAt <= now) {
            const signal = AbortSignal.any([req.signal, AbortSignal.timeout(12_000)]);
            const results = await Promise.allSettled(FEEDS.map(feed => fetchFeed(feed, signal)));
            const headlines: MarketHeadline[] = [];
            const unavailableSources: MarketHeadlineSource[] = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') headlines.push(...result.value);
                else unavailableSources.push(FEEDS[index].source);
            });
            if (!headlines.length) throw new Error('Every official headline source was unavailable');
            memoryCache = {
                expiresAt: now + MEMORY_CACHE_MS,
                fetchedAt: new Date().toISOString(),
                headlines: uniqueNewest(headlines, MAX_HEADLINES),
                unavailableSources,
            };
        }

        return json({
            headlines: memoryCache.headlines.slice(0, limit),
            fetchedAt: memoryCache.fetchedAt,
            unavailableSources: memoryCache.unavailableSources,
        }, 200, 'private, max-age=300, stale-while-revalidate=1800');
    } catch (error) {
        const status = error instanceof RequestError ? error.status : 502;
        console.warn('Market headline feed failed', { status });
        return json({
            error: error instanceof RequestError ? error.message : 'Official market headlines are temporarily unavailable.',
        }, status);
    }
});
