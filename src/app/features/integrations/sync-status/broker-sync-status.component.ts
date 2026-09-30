import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SyncService } from '../../../core/services/sync.service';
import { TradovateService } from '../../../core/services/tradovate.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { UserSessionService } from '../../../core/services/user-session.service';
import { BrokerSyncHistoryService } from './broker-sync-history.service';
import { brokerAccountKey } from './broker-sync.model';

@Component({
    selector: 'app-broker-sync-status', standalone: true, imports: [DatePipe],
    templateUrl: './broker-sync-status.component.html', styleUrl: './broker-sync-status.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrokerSyncStatusComponent {
    readonly sync = inject(SyncService);
    readonly history = inject(BrokerSyncHistoryService);
    private readonly broker = inject(TradovateService);
    private readonly access = inject(AccessPolicyService);
    private readonly session = inject(UserSessionService);
    readonly error = signal<string | null>(null);
    readonly rows = computed(() => {
        if (this.access.demo()) return [];
        const results = new Map(this.sync.accountResults().map(r => [brokerAccountKey(r), r]));
        return this.broker.settingsConnections().flatMap(conn => conn.accounts.map(account => {
            const key = brokerAccountKey({ connectionId: conn.id, accountId: account.id });
            const result = results.get(key);
            const skipped = conn.disabled || account.active === false;
            return {
                key, name: account.name, connection: conn.name, result,
                checkpoint: this.history.checkpoints().get(key),
                failed: !skipped && result?.state === 'failed',
                status: skipped ? 'Historical · not synced' : result ? {
                    fetching: 'Fetching report', saving: 'Saving', synced: 'Synced', failed: 'Needs attention', cancelled: 'Cancelled',
                }[result.state] : 'Not run this session',
                message: skipped ? 'Saved trades are kept. Closed accounts aren’t fetched.' : result?.message,
            };
        }));
    });

    constructor() {
        effect(() => {
            const owner = this.session.userId(), demo = this.access.demo();
            untracked(() => {
                this.error.set(null);
                if (owner && !demo) void this.history.load();
            });
        });
    }

    async retry(): Promise<void> {
        if (this.sync.isSyncing()) return;
        const scope = this.access.capture();
        this.error.set(null);
        try { await this.sync.retryFailedAccounts(); }
        catch (err) {
            if (this.access.isCurrent(scope)) this.error.set(err instanceof Error ? err.message : 'Could not retry. Please try again.');
        }
    }
}
