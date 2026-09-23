import { firstValueFrom, of, Subject, throwError, NEVER } from 'rxjs';
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

describe('independent broker account reports', () => {
    function setup() {
        const service = Object.create(TradovateService.prototype) as any;
        const controller = new AbortController();
        service.captureBroker = () => ({ userId: 'owner', signal: controller.signal });
        service.userSession = { assertCurrent: () => {
            if (controller.signal.aborted) throw new Error('Session changed');
        } };
        service.connections = () => [
            { id: 'A', accounts: [{ id: 1, name: 'Healthy', active: true }, { id: 2, name: 'Bad CSV', active: true }] },
            { id: 'B', accounts: [{ id: 3, name: 'Pending', active: true }, { id: 4, name: 'Historical', active: false }] },
        ];
        return { service, controller };
    }

    it('keeps healthy results and does not cancel another connection after a parse failure', async () => {
        const { service } = setup();
        const pending = new Subject<any[]>();
        service.getPerformanceTrades = vi.fn((_s, _e, _name, id) => id === 1 ? of([{ externalId: 'healthy' }])
            : id === 2 ? throwError(() => new Error('Invalid Performance report row 2: invalid or missing pnl.')) : pending);
        const result = firstValueFrom(service.getAccountTradeReports(new Date('2026-09-01')));
        expect(pending.observed).toBe(true);
        pending.next([{ externalId: 'later' }]); pending.complete();
        expect(await result).toEqual([
            { connectionId: 'A', accountId: 1, accountName: 'Healthy', trades: [{ externalId: 'healthy', connectionId: 'A' }] },
            { connectionId: 'A', accountId: 2, accountName: 'Bad CSV', trades: [], error: 'Invalid Performance report row 2: invalid or missing pnl.' },
            { connectionId: 'B', accountId: 3, accountName: 'Pending', trades: [{ externalId: 'later', connectionId: 'B' }] },
        ]);
        expect(service.getPerformanceTrades).toHaveBeenCalledTimes(3);
    });

    it('distinguishes a verified empty report from an HTTP 404 failure', async () => {
        const { service } = setup();
        service.getPerformanceTrades = vi.fn((_s, _e, _n, id) => id === 2 ? throwError(() => ({ status: 404 })) : of([]));
        const reports = await firstValueFrom(service.getAccountTradeReports(null)) as any[];
        expect(reports[0]).not.toHaveProperty('error');
        expect(reports[1].error).toContain('HTTP 404');
        expect(reports[1].error).not.toContain('inactive');
        // Without creation metadata, a full import must not silently become today-only.
        expect(service.getPerformanceTrades.mock.calls[0][0]).toEqual(new Date('2020-01-01T00:00:00Z'));
    });

    it('continues healthy accounts after broker authorization errors', async () => {
        const { service } = setup();
        service.getPerformanceTrades = vi.fn((_s, _e, _n, id) => id === 2 ? throwError(() => ({ status: 401 })) : of([]));
        const reports = await firstValueFrom(service.getAccountTradeReports(null)) as any[];
        expect(reports.filter(r => !r.error)).toHaveLength(2);
        expect(reports[1].error).toContain('Reconnect');
    });

    it('never presents partial results as complete through the legacy aggregate API', async () => {
        const { service } = setup();
        service.getPerformanceTrades = () => throwError(() => new Error('Invalid Performance report row 2: invalid or missing qty.'));
        await expect(firstValueFrom(service.getAllTrades(null))).rejects.toThrow('Healthy: Invalid Performance report row 2');
    });

    it('bounds a hanging account while retaining the successful ones', async () => {
        vi.useFakeTimers();
        try {
            const { service } = setup();
            service.getPerformanceTrades = (_s: unknown, _e: unknown, _n: unknown, id: number) => id === 2 ? NEVER : of([]);
            const pending = firstValueFrom(service.getAccountTradeReports(null));
            await vi.advanceTimersByTimeAsync(120_000);
            const reports = await pending as any[];
            expect(reports[1].error).toContain('timed out');
            expect(reports.filter(r => !r.error)).toHaveLength(2);
        } finally { vi.useRealTimers(); }
    });

    it('does not swallow a user switch as an ordinary account failure', async () => {
        const { service, controller } = setup();
        service.getPerformanceTrades = () => {
            controller.abort();
            return throwError(() => new Error('Cancelled'));
        };
        await expect(firstValueFrom(service.getAccountTradeReports(null))).rejects.toThrow('Session changed');
    });
});
