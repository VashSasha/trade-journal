import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { TradovateService } from './tradovate.service';

// Parser-only checks avoid constructors, credentials and all broker network calls.
describe('broker reports fail closed', () => {
    const broker = Object.create(TradovateService.prototype) as any;
    it('rejects an HTML login/error page instead of reporting an empty history', () => {
        expect(() => broker.parsePerformanceTrades('<html><h1>Sign in</h1></html>', 123, 'Account')).toThrow('no Trades table');
        expect(() => broker.parseReportHtml('<html>Unavailable</html>', 123)).toThrow('no table');
    });
    it('allows an identified, empty Trades table', () => {
        expect(broker.parsePerformanceTrades('<div class="performance-chart"><h5>Trades</h5><table><tbody></tbody></table></div>', 123, 'Account')).toEqual([]);
    });
    it('does not silently drop an incomplete trade row', () => {
        expect(() => broker.parsePerformanceTrades('<div class="performance-chart"><h5>Trades</h5><table><tbody><tr><td>NQ</td></tr></tbody></table></div>', 123, 'Account')).toThrow('Incomplete');
    });
    it('does not fall back to today-only fills after a historical report error', async () => {
        await expect(firstValueFrom(broker.handleReportError(new Error('Report failed')))).rejects.toThrow('Report failed');
    });

    it('accepts a blank report only after Tradovate confirms it with a second response', async () => {
        const service = Object.create(TradovateService.prototype) as any;
        const post = vi.fn()
            .mockReturnValueOnce(of('   \n'))
            .mockReturnValueOnce(of('\n'));
        service.captureBroker = () => ({ userId: 'owner', signal: new AbortController().signal });
        service.requireToken = () => undefined;
        service.getToken = () => 'token';
        service.getRptUrl = () => 'https://reports.example';
        service.userSession = { assertCurrent: () => undefined };
        service.http = { post };

        await expect(firstValueFrom(service.getPerformanceTrades(
            new Date('2026-09-01T00:00:00Z'),
            new Date('2026-09-09T23:59:59Z'),
            'Fresh Account',
            123,
        ))).resolves.toEqual([]);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('still rejects malformed data returned after a blank report retry', async () => {
        const service = Object.create(TradovateService.prototype) as any;
        const post = vi.fn()
            .mockReturnValueOnce(of(''))
            .mockReturnValueOnce(of('not,a,performance,report'));
        service.captureBroker = () => ({ userId: 'owner', signal: new AbortController().signal });
        service.requireToken = () => undefined;
        service.getToken = () => 'token';
        service.getRptUrl = () => 'https://reports.example';
        service.userSession = { assertCurrent: () => undefined };
        service.http = { post };

        await expect(firstValueFrom(service.getPerformanceTrades(
            new Date('2026-09-01T00:00:00Z'),
            new Date('2026-09-09T23:59:59Z'),
            'Fresh Account',
            123,
        ))).rejects.toThrow('Unrecognized Performance report format');
        expect(post).toHaveBeenCalledTimes(2);
    });
});
