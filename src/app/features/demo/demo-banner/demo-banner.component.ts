import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-demo-banner',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './demo-banner.component.html',
    styleUrl: './demo-banner.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoBannerComponent {
    readonly demo = inject(DemoModeService);
    readonly auth = inject(AuthService);

    exitDemo(): void {
        this.demo.exit();
    }
}
