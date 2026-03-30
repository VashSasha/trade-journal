import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'account_starting_balance';
const COMMISSION_KEY = 'account_commission_per_contract';
const PRESETS = [25000, 50000, 100000, 150000] as const;

@Injectable({ providedIn: 'root' })
export class AccountSettingsService {
    readonly presets = PRESETS;

    startingBalance = signal<number>(this.load());
    commissionPerContract = signal<number>(this.loadCommission());

    set(value: number): void {
        this.startingBalance.set(value);
        localStorage.setItem(STORAGE_KEY, String(value));
    }

    setCommission(value: number): void {
        this.commissionPerContract.set(value);
        localStorage.setItem(COMMISSION_KEY, String(value));
    }

    private load(): number {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? Number(stored) : 25000;
    }

    private loadCommission(): number {
        const stored = localStorage.getItem(COMMISSION_KEY);
        return stored ? Number(stored) : 0.85;
    }
}