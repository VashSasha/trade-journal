import { ChangeDetectionStrategy, Component, inject, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TradeService } from '../../../core/services/trade.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';

const DISMISSED_KEY_PREFIX = 'post_signup_modal_dismissed_';
const NEW_USER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Shown once per user after signup when no trades exist yet.
 * Presents three options: connect broker, explore demo, or skip.
 *
 * Only shows for accounts created within the last 7 days so it never
 * surfaces for existing users who happen to have no trades right now
 * (e.g. a hard refresh before the cloud fetch completes).
 */
@Component({
    selector: 'app-post-signup-modal',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './post-signup-modal.component.html',
    styleUrl: './post-signup-modal.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostSignupModalComponent {
    private auth = inject(AuthService);
    private trades = inject(TradeService);
    private demo = inject(DemoModeService);

    readonly visible = signal(false);

    constructor() {
        // React to signals so trades loading from Supabase can hide the modal
        // if the user already has data (prevents a brief flash for existing users).
        effect(() => {
            const user = this.auth.currentUser();

            // Hide immediately if demo is active or user is logged out.
            if (!user || this.demo.active()) {
                this.visible.set(false);
                return;
            }

            // Already dismissed — don't re-show.
            if (localStorage.getItem(DISMISSED_KEY_PREFIX + user.id)) return;

            // Only show for recently created accounts; existing users know the app.
            const session = this.auth.session();
            const createdAt = session?.user?.created_at;
            if (createdAt) {
                const ageMs = Date.now() - new Date(createdAt).getTime();
                if (ageMs > NEW_USER_THRESHOLD_MS) return;
            }

            // Once trades load the modal hides itself — no flash for existing users.
            if (this.trades.trades().length > 0) {
                this.visible.set(false);
                return;
            }

            this.visible.set(true);
        });
    }

    dismiss(): void {
        const userId = this.auth.currentUser()?.id;
        if (userId) localStorage.setItem(DISMISSED_KEY_PREFIX + userId, '1');
        this.visible.set(false);
    }

    exploreDemo(): void {
        this.dismiss();
        this.demo.enter();
    }
}
