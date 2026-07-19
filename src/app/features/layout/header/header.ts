import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../core/services/theme.service';
import { AccountSelectorComponent } from './account-selector/account-selector.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AccountSelectorComponent, RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  theme = inject(ThemeService);
}
