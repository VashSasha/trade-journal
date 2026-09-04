import { VerdictCard } from './verdict-card.model';

/** Deliberately fictional preview; never generated from an uploaded chart or saved. */
export const DEMO_VERDICT: VerdictCard = {
    symbol: 'SAMPLE', timeframe: 'Example only', direction: 'Long', conviction: 'Illustrative setup',
    confidenceScore: 70, confluenceCount: 2, primarySignal: 'Sample pullback to support',
    levels: {
        entry: { price: '100', note: 'Fictional entry for this demonstration' },
        stop: { price: '98', note: 'Fictional invalidation level' },
        target: { price: '104', note: 'Fictional target—not a trading recommendation' },
    },
    confluences: ['Example higher-low structure', 'Example support retest'],
    contingency: {
        direction: 'Short', trigger: { price: '98', note: 'Example support failure' },
        stop: { price: '100', note: 'Example invalidation' }, target: { price: '94', note: 'Example downside level' },
        condition: 'Illustrates how an alternative scenario is presented.',
    },
    contextChips: ['Sample data', 'Not live analysis', 'No credits used'],
};
