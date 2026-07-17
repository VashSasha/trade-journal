import { Injectable, inject, signal } from '@angular/core';
import { UserDataRepo } from './user-data/user-data.repo';
import { UserSettings } from './user-data/user-data.mappers';
import { CACHE_KEYS, readCache, writeCache } from './user-data/user-data.cache';

const PRESETS = [25000, 50000, 100000, 150000] as const;
const DEFAULT_BALANCE = 25000;
const DEFAULT_COMMISSION = 0.25;

interface SettingsCache {
    startingBalance: number;
    commissionPerContract: number;
}

@Injectable({ providedIn: 'root' })
export class AccountSettingsService {
    private repo = inject(UserDataRepo);

    readonly presets = PRESETS;

    // Starts from the offline cache; UserDataService hydrates from the user's
    // user_settings row after login.
    startingBalance = signal<number>(this.cached()?.startingBalance ?? DEFAULT_BALANCE);
    commissionPerContract = signal<number>(this.cached()?.commissionPerContract ?? DEFAULT_COMMISSION);

    set(value: number): void {
        this.startingBalance.set(value);
        this.persistCache();
        this.repo.queueSettingsUpsert({ startingBalance: value });
    }

    setCommission(value: number): void {
        this.commissionPerContract.set(value);
        this.persistCache();
        this.repo.queueSettingsUpsert({ commissionPerContract: value });
    }

    /** Apply the fetched user_settings row; null resets to defaults (sign-out). */
    hydrate(settings: Pick<UserSettings, 'startingBalance' | 'commissionPerContract'> | null): void {
        this.startingBalance.set(settings?.startingBalance ?? DEFAULT_BALANCE);
        this.commissionPerContract.set(settings?.commissionPerContract ?? DEFAULT_COMMISSION);
        this.persistCache();
    }

    private cached(): SettingsCache | null {
        return readCache<SettingsCache>(CACHE_KEYS.settings);
    }

    private persistCache(): void {
        writeCache(CACHE_KEYS.settings, {
            startingBalance: this.startingBalance(),
            commissionPerContract: this.commissionPerContract()
        } satisfies SettingsCache);
    }
}
