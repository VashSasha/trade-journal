import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgOptimizedImage, TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutService } from '../../../core/services/layout.service';

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

  plan = this.authService.plan;

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  canAccess(requiredPlan: 'premium' | 'lifetime'): boolean {
    const tierRank: Record<string, number> = { free: 0, premium: 1, lifetime: 2, admin: 3 };
    return (tierRank[this.plan()] ?? 0) >= tierRank[requiredPlan];
  }
}
