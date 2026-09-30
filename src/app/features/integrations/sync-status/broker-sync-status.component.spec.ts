import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '../../../core/services/sync.service';
import { TradovateService } from '../../../core/services/tradovate.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { BrokerSyncHistoryService } from './broker-sync-history.service';
import { BrokerSyncStatusComponent } from './broker-sync-status.component';
import { AccountSyncResult, brokerAccountKey } from './broker-sync.model';

function setup() {
    const bad: AccountSyncResult = { connectionId: 'A', accountId: 2, accountName: 'Failed', state: 'failed', message: 'Reconnect this broker.', imported: 0,
        fromDate: null, toDate: '2026-09-30T11:00:00Z' };
    const isSyncing = signal(false), accountResults = signal<AccountSyncResult[]>([bad]);
    const retry = vi.fn(async () => 0), load = vi.fn();
    const history = { checkpoints: signal(new Map([[brokerAccountKey({ connectionId: 'A', accountId: 1 }), {
        connection_id: 'A', account_id: 1, synced_at: '2026-09-30T12:00:00Z', range_from: null, range_to: '2026-09-30T11:00:00Z',
    }]])), loading: signal(false), loaded: signal(true), error: signal<string | null>(null), load };
    TestBed.configureTestingModule({ providers: [
        { provide: SyncService, useValue: { isSyncing, accountResults, retryableAccounts: () => [bad], retryFailedAccounts: retry, retryStateWarning: signal(false) } },
        { provide: BrokerSyncHistoryService, useValue: history },
        { provide: TradovateService, useValue: { settingsConnections: () => [{ id: 'A', name: 'Broker', accounts: [
            { id: 1, name: 'Healthy', active: true }, { id: 2, name: 'Failed', active: true }, { id: 3, name: 'Old account', active: false },
        ] }] } },
        { provide: UserSessionService, useValue: { userId: signal('owner') } },
        { provide: AccessPolicyService, useValue: { demo: signal(false), capture: () => ({}), isCurrent: () => true } },
    ] });
    const fixture = TestBed.createComponent(BrokerSyncStatusComponent); fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, retry, load, isSyncing, history };
}
afterEach(() => TestBed.resetTestingModule());

describe('per-account sync status UI', () => {
    it('shows independent failures, retained historical accounts and persisted success times', () => {
        const { root, load } = setup();
        expect(load).toHaveBeenCalledOnce();
        expect(root.querySelectorAll('li')).toHaveLength(3);
        expect(root.textContent).toContain('Reconnect this broker');
        expect(root.textContent).toContain('Historical · not synced');
        expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-30T12:00:00Z');
        expect(root.textContent).toContain('Not recorded yet');
    });

    it('calls targeted retry and prevents repeated clicks during a sync', async () => {
        const { root, fixture, retry, isSyncing } = setup();
        const button = root.querySelector<HTMLButtonElement>('button')!;
        button.click(); await fixture.whenStable(); expect(retry).toHaveBeenCalledOnce();
        isSyncing.set(true); fixture.detectChanges(); expect(button.disabled).toBe(true);
        button.click(); expect(retry).toHaveBeenCalledOnce();
    });

    it('offers receipt reload separately from broker sync and labels unknown timestamps honestly', () => {
        const { root, fixture, history, load, retry } = setup();
        history.error.set('Saved sync times are unavailable.'); history.loaded.set(false); fixture.detectChanges();
        expect(root.textContent).toContain('Unavailable');
        const reload = [...root.querySelectorAll('button')].find(b => b.textContent === 'Reload sync times')!;
        reload.click(); expect(load).toHaveBeenCalledWith(true); expect(retry).not.toHaveBeenCalled();
    });
});
