import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../../core/services/access-policy.service';
import { AuthService } from '../../../core/services/auth.service';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { MobileNavComponent } from './mobile-nav.component';

@Component({ template: '' })
class Destination {}

describe('mobile navigation', () => {
    const paid = signal(false);
    const logout = vi.fn();
    let resized: (() => void) | undefined;
    let desktop = false;

    beforeEach(() => {
        paid.set(false); logout.mockClear(); desktop = false;
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            get matches() { return desktop; },
            addEventListener: (_: string, callback: () => void) => { resized = callback; },
            removeEventListener: vi.fn(),
        })));
        TestBed.configureTestingModule({ providers: [
            provideRouter([
                { path: 'dashboard', component: Destination },
                { path: 'journal/daily', component: Destination },
                { path: 'account/alerts', component: Destination },
                { path: 'account/profile', component: Destination },
                { path: 'analytics', component: Destination, canActivate: [() => paid() || TestBed.inject(Router).parseUrl('/upgrade')] },
                { path: 'upgrade', component: Destination },
                { path: 'login', component: Destination },
            ]),
            { provide: AccessPolicyService, useValue: { canOpen: () => paid() } },
            { provide: AuthService, useValue: { logout, isAuthenticated: signal(true) } },
            { provide: DemoModeService, useValue: { active: signal(false), enter: vi.fn(), exit: vi.fn() } },
        ] });
    });

    afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

    function setup() {
        const fixture = TestBed.createComponent(MobileNavComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        const dialog = el.querySelector('dialog')!;
        // jsdom has no top layer. Browser checks cover native focus/Escape behavior.
        dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
        dialog.close = vi.fn(() => dialog.removeAttribute('open'));
        return { fixture, el, dialog, component: fixture.componentInstance, router: TestBed.inject(Router) };
    }

    it('labels locked analytics but leaves navigation to the existing guards', async () => {
        const { fixture, el, router } = setup();
        const link = el.querySelector<HTMLAnchorElement>('a[href="/analytics"]')!;
        expect(link.getAttribute('aria-label')).toContain('upgrade required');
        link.click(); await fixture.whenStable();
        expect(router.url).toBe('/upgrade');
        paid.set(true); fixture.detectChanges();
        expect(link.getAttribute('aria-label')).toBe('Analytics');
        link.click(); await fixture.whenStable();
        expect(router.url).toBe('/analytics');
    });

    it('tracks nested Journal and settings destinations', async () => {
        const { fixture, el, component, router } = setup();
        await router.navigateByUrl('/journal/daily'); await fixture.whenStable(); fixture.detectChanges();
        expect(el.querySelector('a[href="/journal"]')!.getAttribute('aria-current')).toBe('page');
        await router.navigateByUrl('/account/profile'); await fixture.whenStable(); fixture.detectChanges();
        expect(component.moreActive()).toBe(true);
        expect(el.querySelector('.mobile-nav button')!.classList.contains('is-active')).toBe(true);
    });

    it('opens the native modal and closes it after navigating to a settings section', async () => {
        const { fixture, dialog, component, router } = setup();
        component.openMore(); fixture.detectChanges();
        expect(dialog.showModal).toHaveBeenCalledOnce();
        expect(component.moreOpen()).toBe(true);
        await router.navigateByUrl('/account/alerts'); await fixture.whenStable();
        expect(dialog.close).toHaveBeenCalledOnce();
        expect(component.moreOpen()).toBe(false);
    });

    it('only dismisses on a backdrop click, and synchronizes a native Escape close', () => {
        const { fixture, el, dialog, component } = setup();
        component.openMore(); fixture.detectChanges();
        el.querySelector('h2')!.click();
        expect(component.moreOpen()).toBe(true);
        dialog.click();
        expect(component.moreOpen()).toBe(false);
        component.openMore();
        dialog.dispatchEvent(new Event('close')); fixture.detectChanges();
        expect(component.moreOpen()).toBe(false);
    });

    it('dismisses the modal when the viewport returns to desktop', () => {
        const { dialog, component } = setup();
        component.openMore(); desktop = true; resized!();
        expect(dialog.close).toHaveBeenCalledOnce();
        expect(component.moreOpen()).toBe(false);
    });

    it('uses the existing sign-out flow', async () => {
        const { fixture, component, router } = setup();
        component.openMore(); component.logout(); await fixture.whenStable();
        expect(logout).toHaveBeenCalledOnce();
        expect(router.url).toBe('/login');
        expect(component.moreOpen()).toBe(false);
    });
});
