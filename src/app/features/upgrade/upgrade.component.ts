import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { AccessPolicyService, PaidFeature } from '../../core/services/access-policy.service';
import { DemoModeService } from '../../core/services/demo-mode.service';

@Component({
    selector: 'app-upgrade',
    standalone: true,
    imports: [TitleCasePipe, RouterLink],
    templateUrl: './upgrade.component.html',
    styleUrl: './upgrade.component.scss'
})
export class UpgradeComponent {
    private router = inject(Router);
    auth = inject(AuthService);
    access = inject(AccessPolicyService);
    demo = inject(DemoModeService);
    private route = inject(ActivatedRoute);
    readonly feature: PaidFeature = this.route.snapshot.queryParamMap.get('feature') === 'broker' ? 'broker'
        : this.route.snapshot.queryParamMap.get('feature') === 'ai' ? 'ai' : 'analytics';

    preview(): void {
        this.demo.enter();
        void this.router.navigateByUrl(this.feature === 'ai' ? '/reports' : '/analytics');
    }

    connect(): void { void this.demo.exit('/settings'); }

    back(): void {
        if (this.demo.active()) void this.demo.exit();
        else void this.router.navigate(['/dashboard']);
    }
}
