import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Standalone "closed beta" screen shown to authenticated users who don't hold
 * the Discord beta-tester role. Rendered outside the app shell (no sidebar /
 * header) — see the `/beta` route. Self-contained widget: no inputs, owns its
 * own copy and the logout action.
 */
@Component({
    selector: 'app-beta-lock',
    standalone: true,
    templateUrl: './beta-lock.component.html',
    styleUrl: './beta-lock.component.scss'
})
export class BetaLockComponent {
    private authService = inject(AuthService);
    private router = inject(Router);

    /** Whop membership — grants the Discord role that unlocks access. */
    readonly whopJoinUrl = 'https://whop.com/nvzn-trading/monthly-trading-access?a=sasha-vash';

    logout(): void {
        this.authService.logout();
        this.router.navigate(['/login']);
    }
}
