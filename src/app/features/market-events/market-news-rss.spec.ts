import { describe, expect, it } from 'vitest';
import { MarketFeedDefinition, parseMarketFeed } from '../../../../supabase/functions/market-news/rss';

const now = Date.parse('2026-09-06T12:00:00.000Z');
const fed: MarketFeedDefinition = {
    source: 'federal-reserve',
    sourceName: 'Federal Reserve Board',
    category: 'monetary-policy',
    url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    hostname: 'www.federalreserve.gov',
    format: 'rss',
};

describe('parseMarketFeed', () => {
    it('parses RSS CDATA and XML entities', () => {
        const result = parseMarketFeed(`
            <rss><channel><item>
                <title>Board&#39;s policy update</title>
                <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260901a.htm]]></link>
                <guid>policy-one</guid>
                <description><![CDATA[<p>A concise &amp; official update.</p>]]></description>
                <pubDate>Tue, 01 Sep 2026 18:00:00 GMT</pubDate>
            </item></channel></rss>
        `, fed, now);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe("Board's policy update");
        expect(result[0].summary).toBe('A concise & official update.');
    });

    it('parses Atom links and rejects links outside the source host', () => {
        const jobs: MarketFeedDefinition = {
            source: 'bls-employment',
            sourceName: 'U.S. Bureau of Labor Statistics',
            category: 'employment',
            url: 'https://www.bls.gov/feed/empsit.rss',
            hostname: 'www.bls.gov',
            format: 'atom',
        };
        const result = parseMarketFeed(`
            <feed>
                <entry><title>Payroll employment increases</title>
                    <link href="https://www.bls.gov/news.release/archives/empsit_09042026.htm"/>
                    <id>jobs-one</id><content>Employment increased.</content>
                    <published>2026-09-04T08:30:00-04:00</published></entry>
                <entry><title>Injected headline</title><link href="https://example.com/bad"/>
                    <published>2026-09-04T08:30:00-04:00</published></entry>
            </feed>
        `, jobs, now);

        expect(result).toHaveLength(1);
        expect(result[0].url).toContain('www.bls.gov');
    });
});
