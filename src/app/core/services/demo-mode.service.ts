import { Injectable, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { TradeService } from './trade.service';
import { DailyJournalService } from './daily-journal.service';
import { AccountSettingsService } from './account-settings.service';
import { TradingAccountsService } from './trading-accounts.service';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { UserDataService } from './user-data/user-data.service';
import { setCacheSuspended, readCache, CACHE_KEYS } from './user-data/user-data.cache';
import { generateDemoData, LIVE_ACCOUNT_ID, HIST_ACCOUNT_ID } from '../demo/demo-data';
import { Trade } from '../models/trade.model';
import { DailyNote, JournalTemplate } from '../models/daily-journal.model';
import { StoredTradingAccount } from './user-data/user-data.mappers';

const SESSION_KEY = 'demo_mode_active';

/**
 * Controls the demo workspace: a fully-populated synthetic dataset that
 * lets prospects explore the app without connecting a broker or signing up.
 *
 * Safety contract:
 *   - Cache is suspended before any demo hydration, so no demo data ever
 *     reaches localStorage (the real user's tj_cache_* keys are untouched).
 *   - All service queue methods are no-ops while suspended (see user-data.repo).
 *   - UserDataService.loadForUser() skips while suspended (see user-data.service).
 *   - On exit, real data is restored from the still-intact localStorage cache.
 */
@Injectable({ providedIn: 'root' })
export class DemoModeService {
    private trades = inject(TradeService);
    private journal = inject(DailyJournalService);
    private settings = inject(AccountSettingsService);
    private accounts = inject(TradingAccountsService);
    private accountService = inject(AccountService);
    private auth = inject(AuthService);
    private userData = inject(UserDataService);
    private router = inject(Router);

    readonly active = signal(false);

    /** Non-null while an upgrade prompt is open; drives UpgradePromptComponent. */
    readonly promptReason = signal<'connect' | 'save' | 'sync' | 'ai' | null>(null);

    /** Set after the user explicitly exits demo to prevent immediate re-entry. */
    private demoOptedOut = false;

    constructor() {
        // Restore demo state across page reloads (same tab session only).
        if (sessionStorage.getItem(SESSION_KEY) === 'true') {
            this.activateDemo();
        }

        // Auto-enter demo for signed-in free users who have no data yet, so
        // they see a populated app instead of an empty one. Uses dataLoaded as
        // a gate so the effect never fires before the Supabase fetch settles.
        effect(() => {
            if (this.active() || this.demoOptedOut) return;
            if (!this.userData.dataLoaded()) return;
            const user = this.auth.currentUser();
            if (!user) {
                this.demoOptedOut = false; // reset when signed out so next user gets a fresh check
                return;
            }
            if (this.auth.plan() !== 'free') return;
            if (this.trades.trades().length > 0) return;
            if (this.accounts.all().length > 0) return;
            this.demoOptedOut = true; // prevent re-entry after this auto-enter
            this.enter();
        }, { allowSignalWrites: true });
    }

    enter(): void {
        this.activateDemo();
        sessionStorage.setItem(SESSION_KEY, 'true');
    }

    /**
     * Call before any write/connect action. Returns true and proceeds normally
     * when not in demo; returns false and opens the upgrade prompt when in demo.
     */
    requireAccount(reason: 'connect' | 'save' | 'sync' | 'ai'): boolean {
        if (!this.active()) return true;
        this.promptReason.set(reason);
        return false;
    }

    dismissPrompt(): void {
        this.promptReason.set(null);
    }

    exit(): void {
        this.demoOptedOut = true; // user chose to leave demo — don't auto-re-enter
        setCacheSuspended(false);
        sessionStorage.removeItem(SESSION_KEY);
        this.active.set(false);

        // Restore real data from localStorage — cache was suspended during demo
        // so the real keys were never overwritten.
        this.restoreFromCache();
        this.accountService.resetLiveAccounts();
        this.accountService.restorePersistedSelection();

        if (this.auth.isAuthenticated()) {
            // Background re-fetch from Supabase to catch any changes while in demo.
            void this.userData.reload();
        } else {
            void this.router.navigate(['/']);
        }
    }

    private activateDemo(): void {
        setCacheSuspended(true);
        this.active.set(true);
        const data = generateDemoData();
        this.trades.hydrate(data.trades);
        this.journal.hydrateNotes(data.notes);
        this.journal.hydrateRules(data.rules);
        this.journal.hydrateTemplates(data.templates);
        this.settings.hydrate(data.settings);
        this.accounts.hydrate(data.tradingAccounts);
        // Place the live account in the "Active" section of the account selector
        // (otherwise both land in "Historical" since TradovateService is untouched).
        this.accountService.setDemoLiveAccount(LIVE_ACCOUNT_ID, 'Demo-Live', 'MARGIN');
        // Pre-select both demo accounts so the header shows a balance immediately.
        this.accountService.setSelectionTransient([LIVE_ACCOUNT_ID, HIST_ACCOUNT_ID]);
    }

    private restoreFromCache(): void {
        const trades = readCache<Trade[]>(CACHE_KEYS.trades) ?? [];
        const notes = readCache<DailyNote[]>(CACHE_KEYS.notes) ?? [];
        const rules = readCache<string[]>(CACHE_KEYS.rules) ?? null;
        const templates = readCache<JournalTemplate[]>(CACHE_KEYS.templates) ?? [];
        const accounts = readCache<StoredTradingAccount[]>(CACHE_KEYS.tradingAccounts) ?? [];
        const settings = readCache<{ startingBalance: number; commissionPerContract: number }>(CACHE_KEYS.settings);

        this.trades.hydrate(trades);
        this.journal.hydrateNotes(notes);
        this.journal.hydrateRules(rules);
        this.journal.hydrateTemplates(templates);
        this.accounts.hydrate(accounts);
        this.settings.hydrate(settings ?? null);
    }
}
