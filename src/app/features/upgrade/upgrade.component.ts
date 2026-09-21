import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { planLabel } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { AccessPolicyService, PaidFeature } from '../../core/services/access-policy.service';
import { DemoModeService } from '../../core/services/demo-mode.service';

@Component({
    selector: 'app-upgrade',
    standalone: true,
    imports: [RouterLink],
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

    readonly planLabel = planLabel;
    readonly hasFeature = computed(() => this.feature === 'ai' ? this.access.ai() : this.access.paid());

    preview(): void {
        this.demo.enter();
        void this.router.navigateByUrl(this.feature === 'ai' ? '/reports' : '/analytics');
    }

    connect(): void { void this.demo.exit(this.feature === 'ai' ? '/reports' : this.feature === 'analytics' ? '/analytics' : '/account/integrations'); }

    back(): void {
        if (this.demo.active()) void this.demo.exit();
        else void this.router.navigate(['/dashboard']);
    }
}
