import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { LayoutService } from '../../../core/services/layout.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { Sidebar } from './sidebar';

@Component({ template: '' })
class Destination {}

describe('workspace sidebar', () => {
    function setup() {
        const collapsed = signal(false);
        const paid = signal(true);
        const logout = vi.fn();
        TestBed.configureTestingModule({ providers: [
            provideRouter([{ path: '**', component: Destination }]),
            { provide: LayoutService, useValue: { collapsed, toggle: () => collapsed.update(value => !value) } },
            { provide: AuthService, useValue: { plan: signal('lifetime'), logout,
                currentUser: signal({ name: 'A trader with a long display name', initials: 'AT', avatar: null, plan: 'lifetime' }) } },
            { provide: DemoModeService, useValue: { active: signal(false), enter: vi.fn(), exit: vi.fn() } },
            { provide: AccessPolicyService, useValue: { canOpen: paid } },
        ] });
        const fixture = TestBed.createComponent(Sidebar); fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        return { fixture, root, collapsed, paid, logout, router: TestBed.inject(Router) };
    }
    afterEach(() => TestBed.resetTestingModule());

    it('keeps named navigation, account settings and logout available when collapsed', () => {
        const { fixture, root, collapsed } = setup();
        const toggle = root.querySelector<HTMLButtonElement>('.sidebar__toggle')!;
        toggle.click(); fixture.detectChanges();
        expect(collapsed()).toBe(true);
        expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        for (const link of root.querySelectorAll('nav a')) expect(link.getAttribute('aria-label')).toBeTruthy();
        expect(root.querySelector('.sidebar__profile')?.getAttribute('href')).toBe('/account/profile');
        expect(root.querySelector('.sidebar__logout')?.getAttribute('aria-label')).toBe('Log out');
    });

    it('announces the active nested route and labels paid destinations without bypassing guards', async () => {
        const { fixture, root, router, paid } = setup();
        await router.navigateByUrl('/journal/daily'); await fixture.whenStable(); fixture.detectChanges();
        expect(root.querySelector('a[href="/journal"]')?.getAttribute('aria-current')).toBe('page');
        paid.set(false); fixture.detectChanges();
        expect(root.querySelector('a[href="/analytics"]')?.getAttribute('aria-label')).toContain('upgrade required');
        expect(root.querySelector('a[href="/reports"]')?.getAttribute('aria-label')).toContain('upgrade required');
        expect(root.querySelector('a[href="/analytics"]')?.getAttribute('href')).toBe('/analytics');
    });

    it('uses the existing logout flow from the collapsed sidebar', async () => {
        const { fixture, root, router, logout, collapsed } = setup();
        collapsed.set(true); fixture.detectChanges();
        root.querySelector<HTMLButtonElement>('.sidebar__logout')!.click(); await fixture.whenStable();
        expect(logout).toHaveBeenCalledOnce();
        expect(router.url).toBe('/login');
    });
});
