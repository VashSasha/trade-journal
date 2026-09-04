import { firstValueFrom } from 'rxjs';
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
});
