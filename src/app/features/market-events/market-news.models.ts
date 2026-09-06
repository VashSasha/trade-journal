export type MarketHeadlineSource = 'federal-reserve' | 'bls-cpi' | 'bls-employment' | 'bls-ppi';
export type MarketHeadlineCategory = 'monetary-policy' | 'inflation' | 'employment';

export interface MarketHeadline {
    id: string;
    title: string;
    summary: string | null;
    url: string;
    publishedAt: string;
    source: MarketHeadlineSource;
    sourceName: string;
    category: MarketHeadlineCategory;
    importance: 'high' | 'medium';
}

interface MarketHeadlineWire {
    id?: unknown;
    title?: unknown;
    summary?: unknown;
    url?: unknown;
    publishedAt?: unknown;
    source?: unknown;
    sourceName?: unknown;
    category?: unknown;
    importance?: unknown;
}

const SOURCE_RULES: Record<MarketHeadlineSource, {
    hostname: string;
    category: MarketHeadlineCategory;
    sourceName: string;
}> = {
    'federal-reserve': {
        hostname: 'www.federalreserve.gov', category: 'monetary-policy', sourceName: 'Federal Reserve Board',
    },
    'bls-cpi': {
        hostname: 'www.bls.gov', category: 'inflation', sourceName: 'U.S. Bureau of Labor Statistics',
    },
    'bls-employment': {
        hostname: 'www.bls.gov', category: 'employment', sourceName: 'U.S. Bureau of Labor Statistics',
    },
    'bls-ppi': {
        hostname: 'www.bls.gov', category: 'inflation', sourceName: 'U.S. Bureau of Labor Statistics',
    },
};

export const MARKET_HEADLINE_SOURCES = Object.keys(SOURCE_RULES) as MarketHeadlineSource[];

function sourceRule(value: unknown): typeof SOURCE_RULES[MarketHeadlineSource] | null {
    return typeof value === 'string' && value in SOURCE_RULES
        ? SOURCE_RULES[value as MarketHeadlineSource]
        : null;
}

function safeSourceUrl(value: unknown, hostname: string): string | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.hostname !== hostname) return null;
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
}

/** Treat the Edge Function response as untrusted input before rendering links. */
export function parseMarketHeadlines(value: unknown): MarketHeadline[] {
    if (!Array.isArray(value)) return [];
    const unique = new Map<string, MarketHeadline>();

    for (const candidate of value.slice(0, 100)) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const wire = candidate as MarketHeadlineWire;
        const rule = sourceRule(wire.source);
        const url = rule ? safeSourceUrl(wire.url, rule.hostname) : null;
        const published = typeof wire.publishedAt === 'string' ? Date.parse(wire.publishedAt) : Number.NaN;
        const title = typeof wire.title === 'string' ? wire.title.trim().slice(0, 220) : '';
        if (!rule || !url || !title || !Number.isFinite(published)
            || wire.category !== rule.category || !['high', 'medium'].includes(String(wire.importance))) continue;

        const summary = typeof wire.summary === 'string' && wire.summary.trim()
            ? wire.summary.trim().slice(0, 360)
            : null;
        const headline: MarketHeadline = {
            id: `${wire.source}:${url}`,
            title,
            summary: summary === title ? null : summary,
            url,
            publishedAt: new Date(published).toISOString(),
            source: wire.source as MarketHeadlineSource,
            sourceName: rule.sourceName,
            category: rule.category,
            importance: wire.importance as 'high' | 'medium',
        };
        const current = unique.get(url);
        if (!current || current.publishedAt < headline.publishedAt) unique.set(url, headline);
    }

    return [...unique.values()]
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.id.localeCompare(right.id))
        .slice(0, 40);
}
