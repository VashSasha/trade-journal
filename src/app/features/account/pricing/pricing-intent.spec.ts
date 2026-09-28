import { pricingIntentFromUrl, pricingReturnUrl, readPricingIntent } from './pricing-intent';

describe('pricing intent', () => {
    for (const plan of ['premium', 'premium_plus'] as const) {
        for (const interval of ['monthly', 'annual'] as const) {
            it(`round-trips ${plan} ${interval}`, () => {
                expect(pricingIntentFromUrl(pricingReturnUrl(plan, interval))).toEqual({ plan, interval });
            });
        }
    }
    it.each(['plan=admin&interval=annual', 'plan=premium_plus&interval=forever', 'plan=premium', 'interval=annual', ''])('ignores incomplete or unrecognized choices: %s', query => {
        expect(readPricingIntent(new URLSearchParams(query))).toBeNull();
    });
    it('does not interpret arbitrary app query parameters as a purchase intent', () => {
        expect(pricingIntentFromUrl('/dashboard?plan=premium_plus&interval=annual')).toBeNull();
    });
});
