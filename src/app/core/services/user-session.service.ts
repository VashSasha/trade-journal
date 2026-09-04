import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface UserOperation {
    userId: string;
    signal: AbortSignal;
}

/** A user switch invalidates every operation started by the previous session. */
@Injectable({ providedIn: 'root' })
export class UserSessionService {
    private client = inject(SupabaseService).client;
    readonly userId = signal<string | null>(null);
    private controller = new AbortController();
    readonly ready: Promise<void>;

    constructor() {
        let eventReceived = false;
        this.client.auth.onAuthStateChange((_event, session) => {
            eventReceived = true;
            this.setUser(session?.user.id ?? null);
        });
        this.ready = this.client.auth.getSession().then(({ data }) => {
            if (!eventReceived) this.setUser(data.session?.user.id ?? null);
        });
    }

    clear(): void { this.setUser(null); }

    capture(): UserOperation {
        const userId = this.userId();
        if (!userId) throw new Error('Please sign in before saving.');
        return { userId, signal: this.controller.signal };
    }

    isCurrent(operation: UserOperation): boolean {
        return !operation.signal.aborted && operation.userId === this.userId();
    }

    assertCurrent(operation: UserOperation): void {
        if (!this.isCurrent(operation)) throw new Error('The session changed. Please try again.');
    }

    private setUser(userId: string | null): void {
        if (this.userId() === userId) return;
        this.controller.abort();
        this.controller = new AbortController();
        this.userId.set(userId);
    }
}
