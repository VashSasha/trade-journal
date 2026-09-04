import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../sidebar/sidebar';
import { Header } from '../header/header';
import { TradovateService } from '../../../core/services/tradovate.service';
import { SyncNoticeComponent } from '../../../shared/components/sync-notice/sync-notice.component';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { DemoBannerComponent } from '../../demo/demo-banner/demo-banner.component';
import { PostSignupModalComponent } from '../../demo/post-signup-modal/post-signup-modal.component';
import { UpgradePromptComponent } from '../../demo/upgrade-prompt/upgrade-prompt.component';

const DISMISSED_KEY = 'tj_banner_dismissed_connections';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, FormsModule, Sidebar, Header, SyncNoticeComponent, DemoBannerComponent, PostSignupModalComponent, UpgradePromptComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent {
    readonly tradovate = inject(TradovateService);
    readonly demo = inject(DemoModeService);

    /** Per-connection IDs the user dismissed; persisted to localStorage. */
    private readonly dismissedIds = signal<Set<string>>(this.loadDismissed());

    /** Expired connections minus disabled and dismissed ones. */
    readonly visibleExpiredConnections = computed(() =>
        this.tradovate.expiredConnections().filter(c => !this.dismissedIds().has(c.id))
    );
    readonly hasVisibleExpiredConnections = computed(() => this.visibleExpiredConnections().length > 0);

    readonly reconnectingId   = signal<string | null>(null);
    readonly reconnectPassword = signal('');
    readonly reconnectLoading = signal(false);
    readonly reconnectError   = signal<string | null>(null);

    dismissBanner(connectionId: string): void {
        const next = new Set(this.dismissedIds());
        next.add(connectionId);
        this.dismissedIds.set(next);
        this.saveDismissed(next);
    }

    markConnectionClosed(connectionId: string): void {
        this.tradovate.disableConnection(connectionId);
        // Clear dismiss entry — disabled connections don't need a dismiss record.
        const next = new Set(this.dismissedIds());
        next.delete(connectionId);
        this.dismissedIds.set(next);
        this.saveDismissed(next);
    }

    startReconnect(connectionId: string): void {
        this.reconnectingId.set(connectionId);
        this.reconnectPassword.set('');
        this.reconnectError.set(null);
    }

    cancelReconnect(): void {
        this.reconnectingId.set(null);
        this.reconnectError.set(null);
    }

    submitReconnect(connectionId: string): void {
        const password = this.reconnectPassword();
        if (!password) return;

        this.reconnectLoading.set(true);
        this.reconnectError.set(null);

        this.tradovate.reconnectConnection(connectionId, password).subscribe({
            next: () => {
                this.reconnectLoading.set(false);
                this.reconnectingId.set(null);
                // Clear dismiss on successful reconnect so the banner can reappear
                // if the token expires again in the future.
                const next = new Set(this.dismissedIds());
                next.delete(connectionId);
                this.dismissedIds.set(next);
                this.saveDismissed(next);
            },
            error: (err: Error) => {
                this.reconnectLoading.set(false);
                this.reconnectError.set(err.message);
            }
        });
    }

    private loadDismissed(): Set<string> {
        try {
            const raw = localStorage.getItem(DISMISSED_KEY);
            return new Set(raw ? JSON.parse(raw) as string[] : []);
        } catch { return new Set(); }
    }

    private saveDismissed(ids: Set<string>): void {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
    }
}
