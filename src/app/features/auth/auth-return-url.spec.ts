import { safeAuthReturnUrl } from './auth-return-url';

describe('auth return destination', () => {
    it.each(['/dashboard', '/journal/daily?date=2026-09-27', '/account/pricing?plan=premium_plus&interval=annual', '/account/plan#billing'])('preserves a local app destination: %s', url => {
        expect(safeAuthReturnUrl(url)).toBe(url);
    });
    it.each([undefined, null, '', 'https://example.com', '//example.com', '/\\example.com', '/%2f%2fexample.com',
        '/account/%5csecret', '/account/%0afoo', '/login?returnUrl=/login', '/auth/callback', '/unknown',
        '/dashboard/../auth/callback', '/dashboard\n', '/account/' + 'x'.repeat(2048)])('rejects unsafe, unsupported or looping destinations', url => {
        expect(safeAuthReturnUrl(url)).toBe('/dashboard');
    });
});
