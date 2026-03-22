import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'account_starting_balance';
const PRESETS = [25000, 50000, 100000, 150000] as const;

@Injectable({ providedIn: 'root' })
export class AccountSettingsService {
    readonly presets = PRESETS;

    startingBalance = signal<number>(this.load());

    set(value: number): void {
        this.startingBalance.set(value);
        localStorage.setItem(STORAGE_KEY, String(value));
    }

    private load(): number {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? Number(stored) : 25000;
    }
}