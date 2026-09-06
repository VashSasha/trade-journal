import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';
import { AccountSelectorComponent } from './account-selector/account-selector.component';
import { SessionsWidgetComponent } from '../../sessions/sessions-widget.component';
import { MarketPanelService } from '../../market-events/market-panel.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AccountSelectorComponent, SessionsWidgetComponent, RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  theme = inject(ThemeService);
  marketPanel = inject(MarketPanelService);
}
