import { Injectable, signal } from '@angular/core';

export type AppAlertTone = 'target' | 'risk' | 'warning' | 'info';

export interface AppAlert {
    id: number;
    tone: AppAlertTone;
    title: string;
    text: string;
}

/** One app-wide, bounded alert queue shared by guardrails and market events. */
@Injectable({ providedIn: 'root' })
export class AlertCenterService {
    readonly current = signal<AppAlert | null>(null);
    private readonly queue: AppAlert[] = [];
    private sequence = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    publish(alert: Omit<AppAlert, 'id'>): void {
        const next = { ...alert, id: ++this.sequence };
        if (this.current()) {
            if (this.queue.length < 4) this.queue.push(next);
            return;
        }
        this.show(next);
    }

    dismiss(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.current.set(null);
        const next = this.queue.shift();
        if (next) this.show(next);
    }

    private show(alert: AppAlert): void {
        this.current.set(alert);
        this.timer = setTimeout(() => this.dismiss(), 12_000);
    }
}
