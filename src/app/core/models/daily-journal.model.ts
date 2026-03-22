export interface DailyNote {
    id: string;
    date: string; // YYYY-MM-DD
    content: string; // free-form rich text notes
    preMarketPlan?: string;
    postMarketReview?: string;
    mood?: number;        // 1-5
    discipline?: number;  // 1-5
    rulesFollowed?: string[]; // checked rule texts
    avoidedNewsEvents?: string[]; // abbrs of auto-detected events the user marked as avoided
    customNewsEvents?: Array<{ name: string; time: string; avoided: boolean }>;
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