import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutService } from '../../../core/services/layout.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, TitleCasePipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  authService = inject(AuthService);
  layout = inject(LayoutService);
  router = inject(Router);
  demo = inject(DemoModeService);
  access = inject(AccessPolicyService);

  plan = this.authService.plan;

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

}
