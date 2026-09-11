import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';
import { AccountSelectorComponent } from './account-selector/account-selector.component';
import { SessionsWidgetComponent } from '../../sessions/sessions-widget.component';
import { MarketPanelService } from '../../market-events/market-panel.service';
import { MasterSoundToggleComponent } from '../../alerts/master-sound-toggle.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AccountSelectorComponent, SessionsWidgetComponent, RouterLink, MasterSoundToggleComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  theme = inject(ThemeService);
  marketPanel = inject(MarketPanelService);
}
