import { Component, inject } from '@angular/core';
import { ThemeService } from '../../../../core/services/theme.service';

/** Appearance: theme toggle (reuses the global ThemeService). */
@Component({
    selector: 'app-account-appearance',
    standalone: true,
    imports: [],
    templateUrl: './account-appearance.component.html',
    styleUrl: './account-appearance.component.scss'
})
export class AccountAppearanceComponent {
    readonly theme = inject(ThemeService);
}
