import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-demo-banner',
    standalone: true,
    imports: [],
    templateUrl: './demo-banner.component.html',
    styleUrl: './demo-banner.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoBannerComponent {
    readonly demo = inject(DemoModeService);
    readonly auth = inject(AuthService);
    readonly access = inject(AccessPolicyService);
    private router = inject(Router);

    exitDemo(): void {
        void this.demo.exit();
    }

    primaryAction(): void {
        if (!this.auth.isAuthenticated()) { void this.router.navigate(['/login']); return; }
        if (!this.access.paid()) { void this.router.navigate(['/upgrade'], { queryParams: { feature: 'broker' } }); return; }
        void this.demo.exit('/settings');
    }
}
