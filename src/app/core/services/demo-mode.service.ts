import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TradeService } from './trade.service';
import { DailyJournalService } from './daily-journal.service';
import { AccountSettingsService } from './account-settings.service';
import { TradingAccountsService } from './trading-accounts.service';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { UserDataService } from './user-data/user-data.service';
import { setCacheSuspended, readCache, CACHE_KEYS, cacheSuspended } from './user-data/user-data.cache';
import { AccessPolicyService } from './access-policy.service';
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
    private access = inject(AccessPolicyService);

    readonly active = cacheSuspended;
    readonly transitioning = signal(false);

    /** Non-null while an upgrade prompt is open; drives UpgradePromptComponent. */
    readonly promptReason = this.access.promptReason;

    constructor() {
        // Restore demo state across page reloads (same tab session only).
        if (sessionStorage.getItem(SESSION_KEY) === 'true') {
            this.activateDemo();
        }

        // Demo is an explicit choice, never an automatic replacement for a
        // free user's real journal (including a legitimately empty journal).
    }

    enter(): void {
        if (this.transitioning()) return;
        this.dismissPrompt();
        this.activateDemo();
        sessionStorage.setItem(SESSION_KEY, 'true');
    }

    /**
     * Shared action gate: free manual saves are allowed in the real workspace;
     * broker/AI actions require paid access. Demo only allows previews.
     */
    requireAccount(reason: 'connect' | 'save' | 'sync' | 'ai'): boolean {
        return this.access.requestAction(reason);
    }

    dismissPrompt(): void {
        this.promptReason.set(null);
    }

    async exit(destination = '/dashboard'): Promise<void> {
        if (this.transitioning()) return;
        this.transitioning.set(true);
        try {
            // Destroy paid preview pages BEFORE restoring any real user data.
            // The router skips same-URL navigation. Already being on the safe
            // dashboard is not a cancellation and must still let demo exit.
            if (this.router.url.split(/[?#]/)[0] !== '/dashboard') {
                const moved = await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
                if (!moved) return;
            }
            this.dismissPrompt();
            this.restoreFromCache(); // cache still suspended during restoration
            this.accountService.resetLiveAccounts();
            this.accountService.restorePersistedSelection();
            sessionStorage.removeItem(SESSION_KEY);
            setCacheSuspended(false);
            if (this.auth.isAuthenticated()) {
                void this.userData.reload();
                if (destination === '/settings' && this.access.canOpen('broker')) {
                    await this.router.navigateByUrl('/settings');
                }
            } else {
                await this.router.navigateByUrl('/');
            }
        } finally { this.transitioning.set(false); }
    }

    private activateDemo(): void {
        setCacheSuspended(true);
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
        // A login/logout in demo may have changed the cache owner. Never show
        // the previous user's data, even briefly while the cloud load starts.
        if (!this.auth.currentUser() || readCache<string>(CACHE_KEYS.owner) !== this.auth.currentUser()?.id) {
            this.trades.hydrate([]); this.journal.hydrateNotes([]);
            this.journal.hydrateRules(null); this.journal.hydrateTemplates([]);
            this.accounts.hydrate([]); this.settings.hydrate(null);
            return;
        }
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
