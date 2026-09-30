import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserOperation, UserSessionService } from '../../../core/services/user-session.service';
import { BrokerAccountTarget, brokerAccountKey, BrokerSyncCheckpoint } from './broker-sync.model';

/** Cloud-confirmed account sync receipts, never broker credentials or trade data. */
@Injectable({ providedIn: 'root' })
export class BrokerSyncHistoryService {
    private readonly client = inject(SupabaseService).client;
    private readonly session = inject(UserSessionService);
    private readonly access = inject(AccessPolicyService);
    private readonly owner = signal<string | null>(null);
    private readonly records = signal(new Map<string, BrokerSyncCheckpoint>());
    private generation = 0;
    private context = '';
    readonly checkpoints = computed(() => this.owner() === this.session.userId() && !this.access.demo()
        ? this.records() : new Map<string, BrokerSyncCheckpoint>());
    readonly loading = signal(false);
    readonly loaded = signal(false);
    readonly error = signal<string | null>(null);

    constructor() {
        this.context = JSON.stringify([this.session.userId(), this.access.demo()]);
        this.owner.set(this.access.demo() ? null : this.session.userId());
        effect(() => {
            const owner = this.session.userId(), demo = this.access.demo();
            const context = JSON.stringify([owner, demo]);
            if (context === this.context) return;
            this.context = context;
            untracked(() => {
                this.generation++;
                this.owner.set(owner);
                this.records.set(new Map());
                this.loaded.set(false);
                this.loading.set(false);
                this.error.set(null);
                // Read lazily when the status widget is used, not on every login.
                if (demo) this.owner.set(null);
            });
        });
    }

    async load(force = false): Promise<void> {
        if (!this.session.userId() || this.access.demo() || this.loading() || (this.loaded() && !force)) return;
        const scope = this.access.capture(), generation = this.generation;
        this.owner.set(scope.userId);
        const current = () => generation === this.generation && this.access.isCurrent(scope);
        this.loading.set(true);
        this.error.set(null);
        try {
            const rows: BrokerSyncCheckpoint[] = [];
            for (let offset = 0; ; offset += 500) {
                const { data, error } = await this.client.from('broker_sync_checkpoints')
                    .select('connection_id,account_id,synced_at,range_from,range_to').eq('user_id', scope.userId)
                    .order('connection_id').order('account_id').range(offset, offset + 499)
                    .abortSignal(scope.signal);
                if (!current()) return;
                if (error) throw error;
                rows.push(...data as BrokerSyncCheckpoint[]);
                if (data.length < 500) break;
            }
            this.merge(rows); // A concurrent successful sync wins over an older read.
            this.loaded.set(true);
        } catch {
            if (current()) this.error.set('Saved sync times are unavailable. Your trades are unchanged.');
        } finally {
            if (current()) this.loading.set(false);
        }
    }

    /** Call only AFTER all queued trade writes have been acknowledged. */
    async record(target: BrokerAccountTarget, from: Date | null, to: Date, scope: UserOperation): Promise<void> {
        this.access.assertCurrent(scope);
        const { data, error } = await this.client.rpc('record_my_broker_sync', {
            p_connection_id: target.connectionId, p_account_id: target.accountId,
            p_from: from?.toISOString() ?? null, p_to: to.toISOString(),
        }).abortSignal(scope.signal);
        this.access.assertCurrent(scope);
        if (error || !data) throw new Error('Trades saved, but the sync time could not be recorded. Retrying is safe.');
        this.owner.set(scope.userId);
        this.merge([data as BrokerSyncCheckpoint]);
    }

    private merge(rows: BrokerSyncCheckpoint[]): void {
        this.records.update(current => {
            const next = new Map(current);
            for (const row of rows) {
                const key = brokerAccountKey({ connectionId: row.connection_id, accountId: row.account_id });
                if (!next.has(key) || Date.parse(row.synced_at) >= Date.parse(next.get(key)!.synced_at)) next.set(key, row);
            }
            return next;
        });
    }
}
