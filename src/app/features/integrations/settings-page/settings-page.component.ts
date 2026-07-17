import { Component } from '@angular/core';
import { TradovateSettingsComponent } from '../components/tradovate-settings/tradovate-settings.component';

/**
 * Settings page shell. Owns the page layout and stacks self-contained settings
 * section widgets (Tradovate connections). Each section is an
 * independent widget — add/remove/reorder here without touching the sections.
 */
@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [TradovateSettingsComponent],
    templateUrl: './settings-page.component.html',
    styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent {}
