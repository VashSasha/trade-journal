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
 * Two separate effects intentionally:
 *  1. Decides whether to show based on account age + dismissed state — no
 *     dependency on when trade data loads, which avoids a timing race during
 *     in-browser account switches (SIGNED_OUT drops trades from the dependency
 *     list before SIGNED_IN fires, so a single effect misses the re-run).
 *  2. Hides reactively once Supabase confirms the user already has trades.
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
        // Effect 1: show/hide based on who's logged in. Never reads trades so
        // the timing of Supabase data loading doesn't affect this decision.
        effect(() => {
            const user = this.auth.currentUser();

            if (!user || this.demo.active()) {
                this.visible.set(false);
                return;
            }

            if (localStorage.getItem(DISMISSED_KEY_PREFIX + user.id)) {
                this.visible.set(false);
                return;
            }

            const session = this.auth.session();
            const createdAt = session?.user?.created_at;
            if (createdAt && Date.now() - new Date(createdAt).getTime() > NEW_USER_THRESHOLD_MS) {
                this.visible.set(false);
                return;
            }

            this.visible.set(true);
        });

        // Effect 2: once real trades arrive, the user has connected — hide.
        effect(() => {
            if (this.trades.trades().length > 0) this.visible.set(false);
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
