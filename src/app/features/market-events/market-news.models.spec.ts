import { describe, expect, it } from 'vitest';
import { parseMarketHeadlines } from './market-news.models';

const validHeadline = {
    id: 'fed:one',
    title: 'Federal Reserve issues FOMC statement',
    summary: 'Policy statement released.',
    url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260901a.htm',
    publishedAt: '2026-09-01T18:00:00.000Z',
    source: 'federal-reserve',
    sourceName: 'Ignored upstream label',
    category: 'monetary-policy',
    importance: 'high',
};

describe('parseMarketHeadlines', () => {
    it('normalizes trusted official headlines and sorts newest first', () => {
        const headlines = parseMarketHeadlines([
            validHeadline,
            {
                ...validHeadline,
                id: 'bls:two',
                title: 'Payroll employment increases',
                url: 'https://www.bls.gov/news.release/archives/empsit_09042026.htm',
                publishedAt: '2026-09-04T11:51:08.000Z',
                source: 'bls-employment',
                category: 'employment',
            },
        ]);

        expect(headlines.map(headline => headline.title)).toEqual([
            'Payroll employment increases', 'Federal Reserve issues FOMC statement',
        ]);
        expect(headlines[0].sourceName).toBe('U.S. Bureau of Labor Statistics');
    });

    it('rejects unsafe links and source/category mismatches', () => {
        expect(parseMarketHeadlines([
            { ...validHeadline, url: 'https://example.com/phishing' },
            { ...validHeadline, category: 'employment' },
            { ...validHeadline, publishedAt: 'not-a-date' },
        ])).toEqual([]);
    });

    it('deduplicates links and ignores malformed values', () => {
        const headlines = parseMarketHeadlines([
            validHeadline,
            { ...validHeadline, id: 'fed:newer', publishedAt: '2026-09-02T18:00:00.000Z' },
            null,
            'bad',
        ]);

        expect(headlines).toHaveLength(1);
        expect(headlines[0].publishedAt).toBe('2026-09-02T18:00:00.000Z');
    });
});
