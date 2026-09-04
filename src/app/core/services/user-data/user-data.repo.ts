import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../supabase.service';
import { UserOperation, UserSessionService } from '../user-session.service';
import { Trade } from '../../models/trade.model';
import { DailyNote, JournalTemplate } from '../../models/daily-journal.model';
import {
  UserSettings, StoredTradingAccount, tradeToRow, rowToTrade, noteToRow, rowToNote,
  templateToRow, rowToTemplate, settingsToRow, rowToSettings, tradingAccountToRow,
  rowToTradingAccount
} from './user-data.mappers';
import { CACHE_KEYS, readCache, isCacheSuspended } from './user-data.cache';

type Row = Record<string, unknown>;
type UserTable = 'trades' | 'journal_entries' | 'journal_templates' | 'trading_accounts' | 'tradovate_connections';
type PendingWrite =
  | { table: UserTable; op: 'upsert'; rows: Row[] }
  | { table: UserTable; op: 'delete'; ids: string[] }
  | { table: 'trades'; op: 'delete-all' }
  | { table: 'user_settings'; op: 'upsert'; row: Row };

interface Envelope {
  key: string;
  userId: string;
  write: PendingWrite
}

const PREFIX = 'tj_outbox_v2:';
const CONFLICT = {
  journal_entries: 'user_id,date', journal_templates: 'user_id,id',
  trading_accounts: 'user_id,account_id', tradovate_connections: 'user_id,connection_id'
};

/** Owner-bound outbox. Persist BEFORE sending; only acknowledged writes are removed.
 * Separate keys prevent another tab's enqueue from overwriting this tab's queue.
 * Sign-out clears UI state, never another user's pending durable writes. */
@Injectable({providedIn: 'root'})
export class UserDataRepo {
  private client = inject(SupabaseService).client;
  private session = inject(UserSessionService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private sequence = 0;
  writeVersion = 0;
  readonly pending = signal(0);
  readonly saveError = signal<string | null>(null);
  readonly canonicalTrades = signal<Trade[]>([]);

  constructor() {
    const retry = () => void this.flushQueue().catch(() => undefined);
    window.addEventListener('online', retry);
    window.addEventListener('storage', retry);
    setInterval(retry, 30_000);
    // Migrate legacy failures ONLY when their owner is known. Unknown-owner
    // data is deliberately not uploaded to whoever next signs in.
    const owner = readCache<string>(CACHE_KEYS.owner);
    const legacy = readCache<PendingWrite[]>(CACHE_KEYS.queue);
    if (owner && legacy?.length) {
      for (const write of legacy) this.persist(owner, write);
      localStorage.removeItem(CACHE_KEYS.queue);
    }
  }

  private async fetchAll(table: UserTable): Promise<Row[]> {
    const scope = this.session.capture();
    const key = table === 'trading_accounts' ? 'account_id' : table === 'tradovate_connections' ? 'connection_id' : 'id';
    const rows: Row[] = [];
    let cursor: string | number | undefined;
    for (; ;) {
      this.session.assertCurrent(scope);
      let query = this.client.from(table).select('*').eq('user_id', scope.userId)
        .order(key, {ascending: true}).limit(500);
      if (cursor !== undefined) query = query.gt(key, cursor);
      const {data, error} = await query.abortSignal(scope.signal);
      this.session.assertCurrent(scope);
      if (error) throw error;
      if (!data?.length) return rows;
      rows.push(...data);
      cursor = data[data.length - 1][key];
      // Continue until empty, even if the project's row cap is <500.
    }
  }

  async fetchTrades(): Promise<Trade[]> {
    return (await this.fetchAll('trades')).map(rowToTrade)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  }
  async fetchConnections(): Promise<Row[]> { return this.fetchAll('tradovate_connections'); }
  queueConnectionUpserts(rows: Row[]): void { this.upsert('tradovate_connections', rows); }

  async fetchNotes(): Promise<DailyNote[]> {
    return (await this.fetchAll('journal_entries')).map(rowToNote);
  }

  async fetchTemplates(): Promise<JournalTemplate[]> {
    return (await this.fetchAll('journal_templates')).map(rowToTemplate);
  }

  async fetchTradingAccounts(): Promise<StoredTradingAccount[]> {
    return (await this.fetchAll('trading_accounts')).map(rowToTradingAccount);
  }

  async fetchSettings(): Promise<UserSettings | null> {
    const scope = this.session.capture();
    const {data, error} = await this.client.from('user_settings').select('*')
      .eq('user_id', scope.userId).abortSignal(scope.signal).maybeSingle();
    this.session.assertCurrent(scope);
    if (error) throw error;
    return data ? rowToSettings(data) : null;
  }

  queueTradeUpserts(trades: Trade[]): void {
    if (isCacheSuspended()) return;
    const owner = this.session.capture().userId;
    if (trades.some(t => t.userId !== owner)) throw new Error('Trade owner changed. Save cancelled.');
    this.upsert('trades', trades.map(tradeToRow));
  }

  queueTradeDeletes(ids: string[]): void {
    this.enqueue({table: 'trades', op: 'delete', ids});
  }

  queueClearAllTrades(): void {
    this.enqueue({table: 'trades', op: 'delete-all'});
  }

  queueNoteUpsert(note: DailyNote): void {
    this.upsert('journal_entries', [noteToRow(note)]);
  }

  queueTemplateUpsert(template: JournalTemplate): void {
    this.upsert('journal_templates', [templateToRow(template)]);
  }

  queueTemplateDelete(id: string): void {
    this.enqueue({table: 'journal_templates', op: 'delete', ids: [id]});
  }

  queueSettingsUpsert(settings: Partial<UserSettings>): void {
    this.enqueue({table: 'user_settings', op: 'upsert', row: settingsToRow(settings)});
  }

  queueTradingAccountUpserts(accounts: StoredTradingAccount[]): void {
    this.upsert('trading_accounts', accounts.map(tradingAccountToRow));
  }

  async importTrades(trades: Trade[]): Promise<void> {
    this.queueTradeUpserts(trades);
    await this.flushQueue();
  }

  async importNotes(notes: DailyNote[]): Promise<void> {
    this.upsert('journal_entries', [...new Map(notes.map(n => [n.date, n])).values()].map(noteToRow));
    await this.flushQueue();
  }

  async importTemplates(templates: JournalTemplate[]): Promise<void> {
    this.upsert('journal_templates', templates.map(templateToRow));
    await this.flushQueue();
  }

  async importSettings(settings: Partial<UserSettings>): Promise<void> {
    this.queueSettingsUpsert(settings);
    await this.flushQueue();
  }

  private upsert(table: UserTable, rows: Row[]): void {
    for (let i = 0; i < rows.length; i += 500) this.enqueue({table, op: 'upsert', rows: rows.slice(i, i + 500)});
  }

  private enqueue(write: PendingWrite): void {
    if (isCacheSuspended()) return;
    const {userId} = this.session.capture();
    this.persist(userId, write);
    this.writeVersion++;
    this.pending.update(count => count + 1);
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushQueue().catch(() => undefined);
    }, 300);
  }

  private persist(userId: string, write: PendingWrite): void {
    this.sequence = Math.max(Date.now() * 1000, this.sequence + 1);
    const key = `${PREFIX}${userId}:${String(this.sequence).padStart(18, '0')}:${crypto.randomUUID()}`;
    try {
      localStorage.setItem(key, JSON.stringify({key, userId, write} satisfies Envelope));
    } catch {
      this.saveError.set('Browser storage is full. This change was not saved. Export your data before closing this page.');
      throw new Error(this.saveError()!);
    }
  }

  private entries(userId: string): Envelope[] {
    return Object.keys(localStorage).filter(k => k.startsWith(`${PREFIX}${userId}:`)).sort()
      .map(k => JSON.parse(localStorage.getItem(k)!) as Envelope);
  }

  async flushQueue(): Promise<void> {
    if (isCacheSuspended() || !this.session.userId()) return;
    if (this.running) {
      await this.running;
      return this.flushQueue();
    }
    const scope = this.session.capture();
    const run = async () => {
      this.session.assertCurrent(scope);
      let items = this.entries(scope.userId);
      this.pending.set(items.length);
      while (items.length) {
        const item = items[0];
        const batch = [item];
        let write = item.write;
        if (write.op === 'upsert' && write.table !== 'user_settings') {
          const table = write.table;
          let rows = [...write.rows];
          for (const next of items.slice(1)) {
            const w = next.write;
            if (w.op !== 'upsert' || w.table !== table || rows.length + w.rows.length > 500) break;
            rows.push(...w.rows); batch.push(next);
          }
          const key = table === 'trading_accounts' ? 'account_id' : table === 'journal_entries' ? 'date' : table === 'tradovate_connections' ? 'connection_id' : 'id';
          rows = [...new Map(rows.map(r => [r[key], r])).values()];
          write = { table, op: 'upsert', rows };
        }
        await this.execute(write, scope);
        this.session.assertCurrent(scope);
        for (const acknowledged of batch) localStorage.removeItem(acknowledged.key);
        items = this.entries(scope.userId);
        this.pending.set(items.length);
      }
      this.saveError.set(null);
    };
    this.running = Promise.resolve(navigator.locks
      ? navigator.locks.request(`${PREFIX}${scope.userId}`, {signal: scope.signal}, run)
      : run()).then(() => undefined).catch(err => {
      if (this.session.isCurrent(scope)) this.saveError.set('Changes are pending on this device, not yet saved to the cloud. Retry when connected.');
      throw err;
    });
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  /** Cancel scheduled work; leave the departing user's durable outbox intact. */
  clearQueue(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.set(0);
    this.saveError.set(null);
    this.canonicalTrades.set([]);
  }

  private async execute(write: PendingWrite, scope: UserOperation): Promise<void> {
    this.session.assertCurrent(scope);
    if (isCacheSuspended()) throw new Error('Saving is paused in demo mode.');
    const owned = (row: Row) => ({...row, user_id: scope.userId});
    if (write.op === 'delete-all') {
      const {error} = await this.client.from('trades').delete().eq('user_id', scope.userId).abortSignal(scope.signal);
      if (error) throw error;
    } else if (write.table === 'user_settings') {
      const {error} = await this.client.from('user_settings').upsert(owned(write.row), {onConflict: 'user_id'}).abortSignal(scope.signal);
      if (error) throw error;
    } else if (write.op === 'upsert') {
      if (write.table === 'trades') {
        const {
          data,
          error
        } = await this.client.rpc('upsert_user_trades', {p_rows: write.rows.map(owned)}).abortSignal(scope.signal);
        this.session.assertCurrent(scope);
        if (error) throw error;
        this.canonicalTrades.set((data ?? []).map(rowToTrade));
      } else {
        const {error} = await this.client.from(write.table).upsert(write.rows.map(owned), {onConflict: CONFLICT[write.table]}).abortSignal(scope.signal);
        if (error) throw error;
      }
    } else {
      const {error} = await this.client.from(write.table).delete().eq('user_id', scope.userId).in('id', write.ids).abortSignal(scope.signal);
      if (error) throw error;
    }
    this.session.assertCurrent(scope);
  }
}
