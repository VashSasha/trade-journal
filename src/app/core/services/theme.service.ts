import { Injectable, effect, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    isDark = signal<boolean>(this.loadPreference());

    /** Whether the user has explicitly chosen a theme (overrides system) */
    private hasOverride = !!localStorage.getItem('theme');

    constructor() {
        // Apply immediately before first render
        document.documentElement.classList.toggle('dark', this.isDark());

        // Keep DOM in sync whenever the signal changes
        effect(() => {
            document.documentElement.classList.toggle('dark', this.isDark());
        });

        // React to OS-level theme changes — only when no user override
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!this.hasOverride) {
                this.isDark.set(e.matches);
            }
        });
    }

    toggle(): void {
        this.hasOverride = true;
        const next = !this.isDark();
        this.isDark.set(next);
        localStorage.setItem('theme', next ? 'dark' : 'light');
    }

    /** Remove override — revert to following system preference */
    resetToSystem(): void {
        this.hasOverride = false;
        localStorage.removeItem('theme');
        this.isDark.set(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    private loadPreference(): boolean {
        const stored = localStorage.getItem('theme');
        if (stored) return stored === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
}
