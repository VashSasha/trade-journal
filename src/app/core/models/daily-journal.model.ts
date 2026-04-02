export type NewsTier = 'T1' | 'T2' | 'T3';

export interface NewsEventTag {
    abbr: string;       // e.g. "CPI", "FOMC", or custom name used as key
    name: string;       // full event name
    tier: NewsTier;
    time?: string;      // e.g. "08:30"
    link?: string;
    isCustom?: boolean;
}

export interface DailyNote {
    id: string;
    date: string; // YYYY-MM-DD
    content: string; // free-form rich text notes
    preMarketPlan?: string;
    postMarketReview?: string;
    mood?: number;        // 1-5
    discipline?: number;  // 1-5
    rulesFollowed?: string[]; // checked rule texts
    /** @deprecated use newsEventTags instead */
    avoidedNewsEvents?: string[];
    /** @deprecated use newsEventTags instead */
    customNewsEvents?: Array<{ name: string; time: string; avoided: boolean }>;
    newsEventTags?: NewsEventTag[];
    tags?: string[];
    createdAt: string;
    updatedAt: string;
}

export const DEFAULT_TRADING_RULES = [
    'Followed my trading plan',
    'Respected max daily loss limit',
    'Only took A+ setups',
    'Managed position size correctly',
    'No revenge trading',
    'Took profits at planned target',
    'Kept emotions in check',
];

export interface JournalTemplate {
    id: string;
    name: string;
    type: 'plan' | 'notes'; // 'plan' is shared between pre-market and post-market
    content: string;        // HTML (from Quill)
    createdAt: string;
    updatedAt: string;
}