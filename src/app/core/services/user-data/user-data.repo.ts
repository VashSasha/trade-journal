import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../supabase.service';
import { Trade } from '../../models/trade.model';
import { DailyNote, JournalTemplate } from '../../models/daily-journal.model';
import {
    UserSettings,
    tradeToRow, rowToTrade,
    noteToRow, rowToNote,
    templateToRow, rowToTemplate,
    settingsToRow, rowToSettings
} from './user-data.mappers';
import { CACHE_KEYS, readCache, writeCache } from './user-data.cache';

type Row = Record<string, unknown>;
type UserTable = 'trades' | 'journal_entries' | 'journal_templates';

/** Composite-PK conflict targets for upserts (user_id fills from its default). */
const CONFLICT: Record<UserTable, string> = {
    trades: 'user_id,id',
    journal_entries: 'user_id,id',
    journal_templates: 'user_id,id'
};

type PendingWrite =
    | { table: UserTable; op: 'upsert'; rows: Row[] }
    | { table: UserTable; op: 'delete'; ids: string[] }
    | { table: 'trades'; op: 'delete-all' }
    | { table: 'user_settings'; op: 'upsert'; row: Row };

/** How long mutations accumulate before being sent as one request. */
const BATCH_DELAY_MS = 300;
const RETRY_INTERVAL_MS = 30_000;
const IMPORT_CHUNK_SIZE = 500;

/**
 * All Supabase reads/writes for user data. Services call the queue* methods
 * fire-and-forget: mutations are micro-batched (a Tradovate sync creating
 * hundreds of trades becomes a handful of upserts) and, when the network is
 * down, land in a localStorage-persisted queue that retries on 'online',
 * on an interval, and after login.
 */
@Injectable({ providedIn: 'root' })
export class UserDataRepo {
    private client = inject(SupabaseService).client;

    // In-flight micro-batches, coalesced by row id.
    private batchedUpserts = new Map<UserTable, Map<string, Row>>();
    private batchedDeletes = new Map<UserTable, Set<string>>();
    private batchedSettings: Row | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Writes that failed on the network, persisted across restarts.
    private queue: PendingWrite[] = readCache<PendingWrite[]>(CACHE_KEYS.queue) ?? [];
    private flushing = false;

    constructor() {
        window.addEventListener('online', () => void this.flushQueue());
        setInterval(() => void this.flushQueue(), RETRY_INTERVAL_MS);
    }

    // ── reads ────────────────────────────────────────────────────────────

    async fetchTrades(): Promise<Trade[]> {
        const { data, error } = await this.client
            .from('trades').select('*').order('entry_date', { ascending: true });
        if (error) throw error;
        return (data as Row[]).map(rowToTrade);
    }

    async fetchNotes(): Promise<DailyNote[]> {
        const { data, error } = await this.client
            .from('journal_entries').select('*').order('date', { ascending: true });
        if (error) throw error;
        return (data as Row[]).map(rowToNote);
    }

    async fetchTemplates(): Promise<JournalTemplate[]> {
        const { data, error } = await this.client
            .from('journal_templates').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return (data as Row[]).map(rowToTemplate);
    }

    async fetchSettings(): Promise<UserSettings | null> {
        const { data, error } = await this.client
            .from('user_settings').select('*').maybeSingle();
        if (error) throw error;
        return data ? rowToSettings(data as Row) : null;
    }

    // ── fire-and-forget writes (batched) ─────────────────────────────────

    queueTradeUpserts(trades: Trade[]): void {
        this.addUpserts('trades', trades.map(t => [t.id, tradeToRow(t)]));
    }

    queueTradeDeletes(ids: string[]): void {
        this.addDeletes('trades', ids);
    }

    queueClearAllTrades(): void {
        // Supersedes anything queued for the table.
        this.batchedUpserts.delete('trades');
        this.batchedDeletes.delete('trades');
        this.queue = this.queue.filter(w => w.table !== 'trades');
        this.persistQueue();
        void this.runOrQueue({ table: 'trades', op: 'delete-all' });
    }

    queueNoteUpsert(note: DailyNote): void {
        this.addUpserts('journal_entries', [[note.id, noteToRow(note)]]);
    }

    queueTemplateUpsert(template: JournalTemplate): void {
        this.addUpserts('journal_templates', [[template.id, templateToRow(template)]]);
    }

    queueTemplateDelete(id: string): void {
        this.addDeletes('journal_templates', [id]);
    }

    queueSettingsUpsert(settings: Partial<UserSettings>): void {
        this.batchedSettings = { ...(this.batchedSettings ?? {}), ...settingsToRow(settings) };
        this.scheduleFlush();
    }

    // ── direct writes (awaited — used by the one-time import) ────────────

    async importTrades(trades: Trade[]): Promise<void> {
        for (let i = 0; i < trades.length; i += IMPORT_CHUNK_SIZE) {
            const chunk = trades.slice(i, i + IMPORT_CHUNK_SIZE).map(tradeToRow);
            await this.execute({ table: 'trades', op: 'upsert', rows: chunk });
        }
    }

    async importNotes(notes: DailyNote[]): Promise<void> {
        // The table enforces one note per (user, date); legacy data should
        // already satisfy that, but dedupe defensively (last write wins).
        const byDate = new Map(notes.map(n => [n.date, n]));
        const rows = [...byDate.values()].map(noteToRow);
        if (rows.length) await this.execute({ table: 'journal_entries', op: 'upsert', rows });
    }

    async importTemplates(templates: JournalTemplate[]): Promise<void> {
        const rows = templates.map(templateToRow);
        if (rows.length) await this.execute({ table: 'journal_templates', op: 'upsert', rows });
    }

    async importSettings(settings: Partial<UserSettings>): Promise<void> {
        await this.execute({ table: 'user_settings', op: 'upsert', row: settingsToRow(settings) });
    }

    // ── batching ─────────────────────────────────────────────────────────

    private addUpserts(table: UserTable, entries: Array<[string, Row]>): void {
        const pending = this.batchedUpserts.get(table) ?? new Map<string, Row>();
        for (const [id, row] of entries) {
            pending.set(id, row);
            this.batchedDeletes.get(table)?.delete(id); // upsert cancels a pending delete
        }
        this.batchedUpserts.set(table, pending);
        this.scheduleFlush();
    }

    private addDeletes(table: UserTable, ids: string[]): void {
        const pending = this.batchedDeletes.get(table) ?? new Set<string>();
        for (const id of ids) {
            pending.add(id);
            this.batchedUpserts.get(table)?.delete(id); // delete cancels a pending upsert
        }
        this.batchedDeletes.set(table, pending);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flushBatch();
        }, BATCH_DELAY_MS);
    }

    private async flushBatch(): Promise<void> {
        const writes: PendingWrite[] = [];

        for (const [table, rows] of this.batchedUpserts) {
            if (rows.size) writes.push({ table, op: 'upsert', rows: [...rows.values()] });
        }
        for (const [table, ids] of this.batchedDeletes) {
            if (ids.size) writes.push({ table, op: 'delete', ids: [...ids] });
        }
        if (this.batchedSettings) {
            writes.push({ table: 'user_settings', op: 'upsert', row: this.batchedSettings });
        }
        this.batchedUpserts.clear();
        this.batchedDeletes.clear();
        this.batchedSettings = null;

        for (const write of writes) await this.runOrQueue(write);
    }

    // ── retry queue ──────────────────────────────────────────────────────

    private async runOrQueue(write: PendingWrite): Promise<void> {
        try {
            await this.execute(write);
        } catch (err) {
            if (this.isNetworkError(err)) {
                this.queue.push(write);
                this.persistQueue();
            } else {
                // Server rejected the write (RLS, constraint, …). Retrying would
                // loop forever; the data is still in the local cache/signals.
                console.error('Supabase write rejected, not retrying:', write.table, err);
            }
        }
    }

    async flushQueue(): Promise<void> {
        if (this.flushing || !this.queue.length || !navigator.onLine) return;
        this.flushing = true;
        try {
            while (this.queue.length) {
                try {
                    await this.execute(this.queue[0]);
                } catch (err) {
                    if (this.isNetworkError(err)) return; // still offline — keep the queue
                    console.error('Dropping rejected queued write:', this.queue[0].table, err);
                }
                this.queue.shift();
                this.persistQueue();
            }
        } finally {
            this.flushing = false;
        }
    }

    /** Sign-out: pending writes belong to the departing user. */
    clearQueue(): void {
        this.batchedUpserts.clear();
        this.batchedDeletes.clear();
        this.batchedSettings = null;
        this.queue = [];
        this.persistQueue();
    }

    private persistQueue(): void {
        writeCache(CACHE_KEYS.queue, this.queue);
    }

    // ── execution ────────────────────────────────────────────────────────

    private async execute(write: PendingWrite): Promise<void> {
        if (write.op === 'delete-all') {
            const { error } = await this.client.from('trades').delete().neq('id', '');
            if (error) throw error;
            return;
        }
        if (write.table === 'user_settings') {
            const { error } = await this.client
                .from('user_settings').upsert(write.row, { onConflict: 'user_id' });
            if (error) throw error;
            return;
        }
        if (write.op === 'upsert') {
            const { error } = await this.client
                .from(write.table).upsert(write.rows, { onConflict: CONFLICT[write.table] });
            if (error) throw error;
            return;
        }
        const { error } = await this.client
            .from(write.table).delete().in('id', write.ids);
        if (error) throw error;
    }

    private isNetworkError(err: unknown): boolean {
        if (!navigator.onLine) return true;
        const message = err instanceof Error ? err.message : String(err);
        return /failed to fetch|networkerror|load failed|fetch failed|timeout/i.test(message);
    }
}
