import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';
import { SupabaseService } from '../supabase.service';
import { TradeService } from '../trade.service';
import { DailyJournalService } from '../daily-journal.service';
import { AccountSettingsService } from '../account-settings.service';
import { UserDataRepo } from './user-data.repo';
import { Trade } from '../../models/trade.model';
import { DailyNote, JournalTemplate } from '../../models/daily-journal.model';
import {
    CACHE_KEYS, LEGACY_KEYS,
    readCache, clearUserCache, hasLegacyData, clearLegacyData
} from './user-data.cache';

/**
 * Orchestrates the localStorage → Postgres data flow around auth events.
 *
 * On login / session restore: runs the one-time legacy import if it hasn't
 * happened for this user, then pulls all rows into the existing service
 * signals (which mirror them back to the cache). If the fetch fails
 * (offline), the signals keep whatever the cache hydrated at construction.
 *
 * On sign-out: clears the cache and pending writes so another user on this
 * machine sees nothing — but leaves the legacy pre-backend keys alone unless
 * this user's import already succeeded.
 *
 * Constructed eagerly via provideAppInitializer in app.config.ts.
 */
@Injectable({ providedIn: 'root' })
export class UserDataService {
    private auth = inject(AuthService);
    private supabase = inject(SupabaseService).client;
    private repo = inject(UserDataRepo);
    private tradeService = inject(TradeService);
    private journalService = inject(DailyJournalService);
    private settingsService = inject(AccountSettingsService);

    /** True while the one-time legacy upload runs — drives the sync notice. */
    readonly importing = signal(false);

    private loadedForUser: string | null = null;
    private importedAt: string | null = null;

    constructor() {
        void this.initialize();

        this.supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                this.onSignOut();
            } else if (event === 'SIGNED_IN' && session) {
                // Defer out of the auth callback (supabase-js serializes calls
                // made inside onAuthStateChange).
                setTimeout(() => void this.loadForUser(session.user.id));
            }
        });

        // A failed startup load (offline) left loadedForUser null — retry the
        // full fetch once connectivity returns.
        window.addEventListener('online', () => {
            const session = this.auth.session();
            if (session && !this.loadedForUser) void this.loadForUser(session.user.id);
        });
    }

    private async initialize(): Promise<void> {
        await this.auth.authReady;
        const session = this.auth.session();
        if (session) await this.loadForUser(session.user.id);
    }

    private async loadForUser(userId: string): Promise<void> {
        if (this.loadedForUser === userId) return;
        this.loadedForUser = userId;

        // The cache belongs to whoever signed in last. A different user means
        // stale foreign data: wipe it before anything can read it.
        if (readCache<string>(CACHE_KEYS.owner) !== userId) {
            clearUserCache();
            this.repo.clearQueue();
            this.resetSignals();
        }
        localStorage.setItem(CACHE_KEYS.owner, JSON.stringify(userId));

        try {
            const settings = await this.repo.fetchSettings();
            this.importedAt = settings?.importedAt ?? null;

            if (!this.importedAt && hasLegacyData()) {
                await this.runLegacyImport();
            } else if (settings) {
                this.settingsService.hydrate(settings);
                this.journalService.hydrateRules(settings.customRules);
            }

            const [trades, notes, templates] = await Promise.all([
                this.repo.fetchTrades(),
                this.repo.fetchNotes(),
                this.repo.fetchTemplates()
            ]);
            this.tradeService.hydrate(trades);
            this.journalService.hydrateNotes(notes);
            this.journalService.hydrateTemplates(templates);

            // Now that we're demonstrably online, retry anything queued.
            await this.repo.flushQueue();
        } catch (err) {
            // Offline (or Supabase unreachable) — the cache-hydrated signals
            // keep the app usable; queued writes retry automatically.
            this.loadedForUser = null; // allow a later retry to re-run the load
            console.warn('Cloud data load failed — running from local cache.', err);
        }
    }

    /**
     * One-time upload of the pre-backend localStorage data. imported_at is
     * only set after every upload succeeded, so a failure (partial or not)
     * simply re-runs on the next login — upserts make that idempotent. The
     * legacy keys are never deleted here.
     */
    private async runLegacyImport(): Promise<void> {
        this.importing.set(true);
        try {
            const trades = readCache<Trade[]>(LEGACY_KEYS.trades) ?? [];
            const notes = readCache<DailyNote[]>(LEGACY_KEYS.notes) ?? [];
            const rules = readCache<string[]>(LEGACY_KEYS.rules);
            const templates = readCache<JournalTemplate[]>(LEGACY_KEYS.templates) ?? [];
            const rawBalance = localStorage.getItem(LEGACY_KEYS.startingBalance);
            const rawCommission = localStorage.getItem(LEGACY_KEYS.commission);

            await this.repo.importTrades(trades);
            await this.repo.importNotes(notes);
            await this.repo.importTemplates(templates);

            const settings = {
                startingBalance: rawBalance ? Number(rawBalance) : 25000,
                commissionPerContract: rawCommission ? Number(rawCommission) : 0.25,
                customRules: rules,
                importedAt: new Date().toISOString()
            };
            await this.repo.importSettings(settings);

            this.importedAt = settings.importedAt;
            this.settingsService.hydrate(settings);
            this.journalService.hydrateRules(rules);
        } finally {
            this.importing.set(false);
        }
    }

    private onSignOut(): void {
        clearUserCache();
        this.repo.clearQueue();
        // Once the legacy data lives in this user's account, the local copy is
        // redundant — and leaving it would let the NEXT user's import absorb it.
        // If the import never ran, it stays untouched.
        if (this.importedAt) clearLegacyData();
        this.loadedForUser = null;
        this.importedAt = null;
        this.importing.set(false);
        this.resetSignals();
    }

    private resetSignals(): void {
        this.tradeService.hydrate([]);
        this.journalService.hydrateNotes([]);
        this.journalService.hydrateRules(null);
        this.journalService.hydrateTemplates([]);
        this.settingsService.hydrate(null);
    }
}
