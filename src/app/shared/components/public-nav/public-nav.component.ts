import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Top navigation for public pages — landing, login. Signed-in visitors
 * always have a visible path back to their workspace.
 * Section links preserve the current landing route; on other pages they
 * use /welcome explicitly so authenticated visitors aren't sent to the dashboard.
 */
@Component({
    selector: 'app-public-nav',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './public-nav.component.html',
    styleUrl: './public-nav.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicNavComponent {
    theme = inject(ThemeService);
    readonly auth = inject(AuthService);

    /** True when rendered on the landing page itself. */
    onLanding = input(false);
}
