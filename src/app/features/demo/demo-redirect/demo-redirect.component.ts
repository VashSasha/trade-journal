import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DemoModeService } from '../../../core/services/demo-mode.service';

/**
 * Activated by the /demo route. Enters demo mode and immediately
 * redirects to /dashboard so all app features are available.
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

    ngOnInit(): void {
        this.demo.enter();
        void this.router.navigate(['/dashboard']);
    }
}
