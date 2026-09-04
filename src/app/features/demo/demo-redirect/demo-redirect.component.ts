import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DemoModeService } from '../../../core/services/demo-mode.service';

/**
 * Activated by the /demo route. Enters demo mode and immediately
 * opens the requested demo page (Dashboard when no destination was given).
 */
@Component({
    selector: 'app-demo-redirect',
    standalone: true,
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoRedirectComponent implements OnInit {
    private demo = inject(DemoModeService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    ngOnInit(): void {
        this.demo.enter();
        // Only accept known demo destinations: never OAuth, external URLs or
        // /demo itself (which could loop). These are the plan-gated pages.
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
        const path = returnUrl.split(/[?#]/)[0];
        const allowed = ['/journal', '/journal/daily', '/analytics', '/reports'];
        void this.router.navigateByUrl(allowed.includes(path) ? returnUrl : '/dashboard', { replaceUrl: true });
    }
}
