import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';
import { AccountSelectorComponent } from './account-selector/account-selector.component';
import { SessionsWidgetComponent } from '../../sessions/sessions-widget.component';
import { MarketPanelService } from '../../market-events/market-panel.service';
import { LiveCoachToggleComponent } from '../../live-coach/live-coach-toggle.component';
import { LiveCoachService } from '../../live-coach/live-coach.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AccountSelectorComponent, SessionsWidgetComponent, RouterLink, LiveCoachToggleComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  coach = inject(LiveCoachService);
  theme = inject(ThemeService);
  marketPanel = inject(MarketPanelService);
}
