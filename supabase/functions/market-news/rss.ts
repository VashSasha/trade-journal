export type MarketHeadlineSource = 'federal-reserve' | 'bls-cpi' | 'bls-employment' | 'bls-ppi';
export type MarketHeadlineCategory = 'monetary-policy' | 'inflation' | 'employment';

export interface MarketFeedDefinition {
    source: MarketHeadlineSource;
    sourceName: string;
    category: MarketHeadlineCategory;
    url: string;
    hostname: string;
    format: 'rss' | 'atom';
}

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

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HEADLINE_AGE_MS = 370 * DAY_MS;

function decodeXml(value: string): string {
    const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
    return withoutCdata.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,
        (entity, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
            if (hex || decimal) {
                const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
                return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
            }
            return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named?.toLowerCase() ?? '']
                ?? entity;
        });
}

function cleanText(value: string | null, limit: number): string {
    if (!value) return '';
    return decodeXml(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
}

function element(block: string, name: string): string | null {
    return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? null;
}

function atomLink(block: string): string | null {
    const tag = block.match(/<link\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*\/?\s*>/i);
    return tag?.[1] ?? tag?.[2] ?? null;
}

function safeUrl(value: string, definition: MarketFeedDefinition): string | null {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.hostname !== definition.hostname) return null;
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
}

export function parseMarketFeed(
    xml: string,
    definition: MarketFeedDefinition,
    now = Date.now(),
): MarketHeadline[] {
    const blockPattern = definition.format === 'atom'
        ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
        : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    const blocks = [...xml.replace(/^\uFEFF/, '').matchAll(blockPattern)].map(match => match[1]);
    const headlines: MarketHeadline[] = [];

    for (const block of blocks) {
        const title = cleanText(element(block, 'title'), 220);
        const rawUrl = definition.format === 'atom'
            ? cleanText(atomLink(block), 1_000)
            : cleanText(element(block, 'link'), 1_000);
        const url = safeUrl(rawUrl, definition);
        const rawDate = element(block, 'published') ?? element(block, 'pubDate') ?? element(block, 'updated');
        const timestamp = Date.parse(cleanText(rawDate, 100));
        if (!title || !url || !Number.isFinite(timestamp)
            || timestamp > now + DAY_MS || timestamp < now - MAX_HEADLINE_AGE_MS) continue;

        const rawSummary = element(block, 'content') ?? element(block, 'description') ?? element(block, 'summary');
        const summaryText = cleanText(rawSummary, 360);
        const rawId = cleanText(element(block, 'id') ?? element(block, 'guid'), 500) || url;
        headlines.push({
            id: `${definition.source}:${rawId}`,
            title,
            summary: summaryText && summaryText !== title ? summaryText : null,
            url,
            publishedAt: new Date(timestamp).toISOString(),
            source: definition.source,
            sourceName: definition.sourceName,
            category: definition.category,
            importance: 'high',
        });
    }

    return headlines;
}

export function uniqueNewest(headlines: MarketHeadline[], limit: number): MarketHeadline[] {
    const unique = new Map<string, MarketHeadline>();
    for (const headline of headlines) {
        const key = headline.url.toLowerCase();
        const current = unique.get(key);
        if (!current || current.publishedAt < headline.publishedAt) unique.set(key, headline);
    }
    return [...unique.values()]
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.id.localeCompare(right.id))
        .slice(0, limit);
}
