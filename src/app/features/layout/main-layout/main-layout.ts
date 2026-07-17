import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../sidebar/sidebar';
import { Header } from '../header/header';
import { TradovateService } from '../../../core/services/tradovate.service';
import { SyncNoticeComponent } from '../../../shared/components/sync-notice/sync-notice.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, FormsModule, Sidebar, Header, SyncNoticeComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent {
    readonly tradovate = inject(TradovateService);

    readonly bannerDismissed  = signal(false);
    readonly reconnectingId   = signal<string | null>(null);
    readonly reconnectPassword = signal('');
    readonly reconnectLoading = signal(false);
    readonly reconnectError   = signal<string | null>(null);

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
            },
            error: (err: Error) => {
                this.reconnectLoading.set(false);
                this.reconnectError.set(err.message);
            }
        });
    }
}
