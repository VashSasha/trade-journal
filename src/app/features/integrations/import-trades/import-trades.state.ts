import { Injectable, computed, inject, signal } from '@angular/core';
import { TradeService } from '../../../core/services/trade.service';
import { TradovateService, TradovateAccount } from '../../../core/services/tradovate.service';
import { AccountService } from '../../../core/services/account.service';
import { AccountSettingsService } from '../../../core/services/account-settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { parsePerformanceCsv, PerformanceCsvTrade } from '../../../core/utils/tradovate-performance.utils';
import { splitByExisting, stableAccountIdFromName } from './import-trades.utils';

export interface ImportPreview {
    total: number;
    newTrades: PerformanceCsvTrade[];
    duplicateCount: number;
    firstDate: string | null;
    lastDate: string | null;
    symbols: string[];
}

export interface AccountGroup {
    label: string;
    accounts: TradovateAccount[];
}

/** Sentinel value for the "enter account name" selector option. */
export const CUSTOM_ACCOUNT = 'custom';

@Injectable()
export class ImportTradesState {
    private tradeService = inject(TradeService);
    private tradovateService = inject(TradovateService);
    private accountService = inject(AccountService);
    private accountSettings = inject(AccountSettingsService);
    private authService = inject(AuthService);
    private demo = inject(DemoModeService);

    fileName = signal<string | null>(null);
    private csvText = signal<string | null>(null);
    fileError = signal<string | null>(null);
    isDragOver = signal(false);

    /** Numeric account id as a string, CUSTOM_ACCOUNT, or null (nothing chosen). */
    selectedAccountKey = signal<string | null>(null);
    customAccountName = signal('');

    isImporting = signal(false);
    importResult = signal<{ imported: number; skipped: number } | null>(null);

    accountGroups = computed<AccountGroup[]>(() => [
        { label: 'Active accounts', accounts: this.accountService.accounts() },
        { label: 'Inactive accounts', accounts: this.accountService.inactiveAccounts() },
        { label: 'Historical accounts', accounts: this.accountService.historicalAccounts() }
    ].filter(g => g.accounts.length > 0));

    /**
     * The account the import will be attributed to. For a known account the id
     * comes from Tradovate (and connectionId is stamped when the account belongs
     * to a connection); for a manually-entered name a deterministic synthetic id
     * is derived so re-imports dedupe. Once trades land, the account shows up in
     * AccountService.historicalAccounts automatically (derived from trades).
     */
    targetAccount = computed<{ id: number; name: string; connectionId?: string } | null>(() => {
        const key = this.selectedAccountKey();
        if (!key) return null;

        if (key === CUSTOM_ACCOUNT) {
            const name = this.customAccountName().trim();
            if (!name) return null;
            return { id: stableAccountIdFromName(name), name };
        }

        const id = Number(key);
        const all = [
            ...this.accountService.accounts(),
            ...this.accountService.inactiveAccounts(),
            ...this.accountService.historicalAccounts()
        ];
        const acc = all.find(a => a.id === id);
        if (!acc) return null;

        const conn = this.tradovateService.connections().find(c => c.accounts.some(a => a.id === id));
        return { id: acc.id, name: acc.name, connectionId: conn?.id };
    });

    /**
     * Live preview — recomputes when the file, the chosen account, or the stored
     * trades change (so a sync finishing mid-preview updates the duplicate count).
     */
    preview = computed<ImportPreview | null>(() => {
        const csv = this.csvText();
        const acc = this.targetAccount();
        if (!csv || !acc) return null;

        const parsed = parsePerformanceCsv(csv, acc.id, acc.name);
        const { newTrades, duplicates } = splitByExisting(parsed, this.tradeService.trades());

        const dates = parsed.flatMap(t => [t.entryDate, t.exitDate]).sort();
        return {
            total: parsed.length,
            newTrades,
            duplicateCount: duplicates.length,
            firstDate: dates[0] ?? null,
            lastDate: dates[dates.length - 1] ?? null,
            symbols: [...new Set(parsed.map(t => t.symbol))]
        };
    });

    async loadFile(file: File): Promise<void> {
        this.fileError.set(null);
        this.importResult.set(null);

        if (!/\.csv$/i.test(file.name)) {
            this.fileError.set('Please choose a .csv file (Tradovate Performance report export).');
            return;
        }

        try {
            const text = await file.text();
            this.csvText.set(text);
            this.fileName.set(file.name);
        } catch {
            this.fileError.set('Could not read the file. Please try again.');
        }
    }

    clearFile(): void {
        this.csvText.set(null);
        this.fileName.set(null);
        this.fileError.set(null);
    }

    /**
     * Commit the new trades through the same pipeline SyncService uses:
     * commission-fallback fees (the CSV carries none), createTrade (which guards
     * duplicate externalIds and queues the Supabase upsert — the DB's unique
     * (user_id, external_id) index rejects any cross-tab race with a concurrent
     * sync), then recalculateTradovateNetPnl for fee reconciliation.
     */
    import(): void {
        if (!this.demo.requireAccount('sync')) return;
        const preview = this.preview();
        const acc = this.targetAccount();
        const user = this.authService.currentUser();
        if (!preview || !acc || !user || preview.newTrades.length === 0 || this.isImporting()) return;

        this.isImporting.set(true);
        try {
            const commission = this.accountSettings.commissionPerContract();
            const toImport = preview.newTrades.map(t => {
                const fees = t.fees !== undefined
                    ? t.fees
                    : parseFloat((commission * t.quantity * 2).toFixed(2));
                const netPnl = parseFloat((t.pnl - fees).toFixed(2));
                return {
                    ...t,
                    fees,
                    netPnl,
                    source: 'tradovate' as const,
                    connectionId: acc.connectionId
                };
            });

            let imported = 0;
            for (const t of toImport) {
                this.tradeService.createTrade(t, user.id);
                imported++;
            }

            this.tradeService.recalculateTradovateNetPnl(commission);
            this.importResult.set({ imported, skipped: preview.duplicateCount });
            this.clearFile();
        } finally {
            this.isImporting.set(false);
        }
    }
}
