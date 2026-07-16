import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const;

/** How often user activity is persisted as a refreshed expiry. */
const REFRESH_THROTTLE_MS = 30_000;

/** How often the current session is checked against its stored expiry. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * Logs the user out after SESSION_IDLE_TIMEOUT_MS without activity.
 *
 * Activity in any tab slides the expiry persisted by AuthService; every tab
 * checks that shared expiry on an interval (and when its tab becomes visible,
 * so a woken laptop logs out immediately instead of waiting a tick).
 */
@Injectable({ providedIn: 'root' })
export class SessionTimeoutService {
    private authService = inject(AuthService);
    private router = inject(Router);

    private checkTimer: ReturnType<typeof setInterval> | null = null;
    private lastRefresh = 0;

    private readonly onActivity = (): void => {
        const now = Date.now();
        if (now - this.lastRefresh < REFRESH_THROTTLE_MS) return;
        this.lastRefresh = now;
        this.authService.refreshSessionExpiry();
    };

    private readonly onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') this.checkExpiry();
    };

    constructor() {
        effect(() => {
            if (this.authService.isAuthenticated()) {
                this.start();
            } else {
                this.stop();
            }
        });
    }

    private start(): void {
        if (this.checkTimer !== null) return;
        this.lastRefresh = Date.now();
        for (const event of ACTIVITY_EVENTS) {
            document.addEventListener(event, this.onActivity, { passive: true });
        }
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.checkTimer = setInterval(() => this.checkExpiry(), CHECK_INTERVAL_MS);
    }

    private stop(): void {
        if (this.checkTimer === null) return;
        clearInterval(this.checkTimer);
        this.checkTimer = null;
        for (const event of ACTIVITY_EVENTS) {
            document.removeEventListener(event, this.onActivity);
        }
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }

    private checkExpiry(): void {
        const expiry = this.authService.storedSessionExpiry();
        // Null expiry means storage was cleared (e.g. logout in another tab).
        if (expiry !== null && Date.now() <= expiry) return;
        this.stop();
        this.authService.logout();
        this.router.navigate(['/login'], { queryParams: { reason: 'session-expired' } });
    }
}
