import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Top navigation for public (logged-out) pages — landing, login.
 * On the landing page section links are native anchors (smooth-scrolled);
 * on other pages they navigate back to the landing with a fragment.
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

    /** True when rendered on the landing page itself. */
    onLanding = input(false);
}
