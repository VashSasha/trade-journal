export interface DailyNote {
    id: string;
    date: string; // YYYY-MM-DD
    content: string; // free-form rich text notes
    preMarketPlan?: string;
    postMarketReview?: string;
    mood?: number;        // 1-5
    discipline?: number;  // 1-5
    rulesFollowed?: string[]; // checked rule texts
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
