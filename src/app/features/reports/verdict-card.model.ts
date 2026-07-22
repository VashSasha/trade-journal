export interface VerdictCard {
    symbol: string;
    timeframe: string;
    direction: 'Long' | 'Short';
    conviction: string;
    confidenceScore: number;
    confluenceCount: number;
    primarySignal: string;
    levels: {
        entry:  { price: string; note: string };
        stop:   { price: string; note: string };
        target: { price: string; note: string };
    };
    confluences: string[];
    contingency: {
        direction: 'Long' | 'Short';
        trigger: { price: string; note: string };
        stop:    { price: string; note: string };
        target:  { price: string; note: string };
        condition: string;
    };
    contextChips: string[];
}
