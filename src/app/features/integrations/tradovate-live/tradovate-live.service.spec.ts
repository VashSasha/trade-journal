import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { AccountService } from '../../../core/services/account.service';
import { SyncService } from '../../../core/services/sync.service';
import { TradovateConnection, TradovateService } from '../../../core/services/tradovate.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import { TradovateLiveService } from './tradovate-live.service';

class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static readonly instances: FakeWebSocket[] = [];

    readonly sent: string[] = [];
    readyState = FakeWebSocket.OPEN;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(message: string): void { this.sent.push(message); }

    close(): void {
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
    }

    emit(data: string): void {
        this.onmessage?.({ data } as MessageEvent);
    }
}

class FakeBroadcastChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) { }
    postMessage(_message: unknown): void { }
    close(): void { }
}

const connection: TradovateConnection = {
    id: 'connection-1',
    name: 'Funded',
    token: 'broker-token',
    tokenExpiresAt: '2099-01-01T00:00:00.000Z',
    config: { authMode: 'oauth', environment: 'live' },
    accounts: [{ id: 10, name: 'Account 10', userId: 99, accountType: 'PA', active: true }],
    createdAt: '2026-08-01T00:00:00.000Z',
};

describe('TradovateLiveService', () => {
    const connections = signal<TradovateConnection[]>([connection]);
    const userId = signal<string | null>('owner-1');
    const applyLiveBalances = vi.fn();
    const markConnectionExpired = vi.fn();
    const ensureFreshToken = vi.fn(async () => undefined);

    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances.length = 0;
        connections.set([connection]);
        userId.set('owner-1');
        applyLiveBalances.mockReset();
        markConnectionExpired.mockReset();
        ensureFreshToken.mockClear();
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

        TestBed.configureTestingModule({ providers: [
            { provide: TradovateService, useValue: {
                connections,
                ensureFreshToken,
                markConnectionExpired,
                getAccountsForConnection: () => of(connection.accounts),
            } },
            { provide: AccountService, useValue: { applyLiveBalances } },
            { provide: SyncService, useValue: { isSyncing: signal(false), syncTrades: vi.fn(async () => 0) } },
            { provide: UserSessionService, useValue: { userId } },
            { provide: AccessPolicyService, useValue: { canAct: () => true } },
        ] });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('authorizes, starts user sync and projects broker updates without storing raw events', async () => {
        const service = TestBed.inject(TradovateLiveService);
        service.setRequested('test', true);
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        const socket = FakeWebSocket.instances[0];
        expect(socket.url).toBe('wss://live.tradovateapi.com/v1/websocket');
        socket.emit('o');
        expect(socket.sent[0]).toBe('authorize\n1\n\nbroker-token');
        socket.emit('a[{"i":1,"s":200}]');
        expect(socket.sent[1]).toContain('user/syncrequest\n2\n\n');
        expect(socket.sent[1]).toContain('"accounts":[10]');
        expect(socket.sent[1]).toContain('"entityTypes":["cashBalance","position"]');
        socket.emit('o');
        expect(socket.sent[2]).toBe('[]');
        expect(socket.sent.filter(message => message.startsWith('authorize'))).toHaveLength(1);

        socket.emit('a[{"i":2,"s":200,"d":{"users":[{"id":99}],"cashBalances":[{"id":1,"accountId":10,"amount":50400,"realizedPnL":400,"weekRealizedPnL":900,"tradeDate":{"year":2026,"month":8,"day":4}}],"positions":[]}}]');
        expect(service.state()).toBe('live');
        expect(service.metrics()[0]).toEqual(expect.objectContaining({
            accountId: 10, dailyPnl: 400, weeklyPnl: 900, balance: 50_400,
        }));
        expect(applyLiveBalances).toHaveBeenCalledWith(
            'connection-1',
            [expect.objectContaining({ accountId: 10, amount: 50_400 })],
        );

        socket.emit('a[{"e":"props","d":{"entityType":"cashBalance","entity":{"id":1,"accountId":10,"amount":50600,"realizedPnL":600,"weekRealizedPnL":1100,"tradeDate":{"year":2026,"month":8,"day":4}}}}]');
        expect(service.metrics()[0]).toEqual(expect.objectContaining({ dailyPnl: 600, balance: 50_600 }));

        socket.close();
        expect(service.state()).toBe('reconnecting');
        expect(service.metrics()).toEqual([]);
    });

    it('marks rejected broker tokens for reauthentication instead of reconnecting forever', async () => {
        const service = TestBed.inject(TradovateLiveService);
        service.setRequested('test', true);
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        const socket = FakeWebSocket.instances[0];
        socket.emit('o');
        socket.emit('a[{"i":1,"s":401,"d":{"errorText":"Access denied"}}]');

        expect(markConnectionExpired).toHaveBeenCalledWith('connection-1');
        expect(service.state()).toBe('needs-auth');
        vi.advanceTimersByTime(60_000);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('keeps REST sync available when only user-stream permission is denied', async () => {
        const service = TestBed.inject(TradovateLiveService);
        service.setRequested('test', true);
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        const socket = FakeWebSocket.instances[0];
        socket.emit('o');
        socket.emit('a[{"i":1,"s":200}]');
        socket.emit('a[{"i":2,"s":401,"d":"Access is denied"}]');

        expect(markConnectionExpired).not.toHaveBeenCalled();
        expect(service.state()).toBe('unavailable');
        expect(service.statusDetail()).toContain('Regular sync still works');
    });

    it('keeps one shared stream alive until every realtime feature releases it', async () => {
        const service = TestBed.inject(TradovateLiveService);
        service.setRequested('performance-alerts', true);
        service.setRequested('live-coach', true);
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();

        const socket = FakeWebSocket.instances[0];
        service.setRequested('performance-alerts', false);
        TestBed.tick();
        expect(socket.readyState).toBe(FakeWebSocket.OPEN);

        service.setRequested('live-coach', false);
        TestBed.tick();
        expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
        expect(service.state()).toBe('off');
    });
});
