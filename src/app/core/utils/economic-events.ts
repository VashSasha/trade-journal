import { isMarketClosed } from './market-holidays';

export interface EconomicEvent {
    event: string;
    abbr: string;
    date: string;  // YYYY-MM-DD
    time: string;  // HH:mm ET (Eastern Time)
    impact: 'high' | 'medium';
    link: string;  // official source URL
    estimated?: boolean;
}

// ── FOMC Rate Decision dates (day 2 of 2-day meeting) ────────────────────────
// Source: federalreserve.gov/monetarypolicy/fomccalendars.htm
const FOMC_DATES: string[] = [
    // 2024
    '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
    '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
    // 2025
    '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
    '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
    // 2026 (estimated — Fed typically announces in Dec of prior year)
    '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
    '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
];

// ── CPI release dates ─────────────────────────────────────────────────────────
// Source: bls.gov/schedule/news_release/cpi.htm (8:30am ET)
const CPI_DATES: string[] = [
    // 2024
    '2024-01-11', '2024-02-13', '2024-03-12', '2024-04-10',
    '2024-05-15', '2024-06-12', '2024-07-11', '2024-08-14',
    '2024-09-11', '2024-10-10', '2024-11-13', '2024-12-11',
    // 2025
    '2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10',
    '2025-05-13', '2025-06-11', '2025-07-15', '2025-08-12',
    '2025-09-10', '2025-10-14', '2025-11-13', '2025-12-10',
    // 2026 (estimated)
    '2026-01-14', '2026-02-11', '2026-03-11', '2026-04-15',
    '2026-05-13', '2026-06-10', '2026-07-15', '2026-08-12',
    '2026-09-09', '2026-10-14', '2026-11-12', '2026-12-09',
];

function toDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * NFP (Non-Farm Payrolls) — released on the first Friday of the month at 8:30am ET.
 * If that Friday is a market holiday, it shifts to the second Friday.
 */
function nfpDate(year: number, month: number): string {
    for (let d = 1; d <= 14; d++) {
        const date = new Date(year, month, d);
        if (date.getDay() === 5 && !isMarketClosed(date)) {
            return toDateStr(date);
        }
    }
    // fallback: first Friday regardless
    for (let d = 1; d <= 7; d++) {
        const date = new Date(year, month, d);
        if (date.getDay() === 5) return toDateStr(date);
    }
    return '';
}

/** Returns economic events (FOMC, CPI, NFP) for a given month. */
export function getEconomicEventsForMonth(year: number, month: number): EconomicEvent[] {
    const mm = String(month + 1).padStart(2, '0');
    const prefix = `${year}-${mm}`;
    const events: EconomicEvent[] = [];

    // FOMC
    FOMC_DATES.filter(d => d.startsWith(prefix)).forEach(d => {
        events.push({
            event: 'FOMC Rate Decision',
            abbr: 'FOMC',
            date: d,
            time: '14:00',
            impact: 'high',
            link: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
            estimated: d.startsWith('2026')
        });
    });

    // CPI
    CPI_DATES.filter(d => d.startsWith(prefix)).forEach(d => {
        events.push({
            event: 'Consumer Price Index (CPI)',
            abbr: 'CPI',
            date: d,
            time: '08:30',
            impact: 'high',
            link: 'https://www.bls.gov/news.release/cpi.htm',
            estimated: d.startsWith('2026')
        });
    });

    // NFP
    const nfp = nfpDate(year, month);
    if (nfp) {
        events.push({
            event: 'Non-Farm Payrolls (NFP)',
            abbr: 'NFP',
            date: nfp,
            time: '08:30',
            impact: 'high',
            link: 'https://www.bls.gov/news.release/empsit.htm',
            estimated: true
        });
    }

    return events;
}
