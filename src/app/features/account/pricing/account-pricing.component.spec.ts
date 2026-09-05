import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { routes } from '../../../app.routes';
import { signedInGuard } from '../../../core/guards/auth.guard';
import { AuthService } from '../../../core/services/auth.service';
import { AccountService } from '../account.service';
import { BillingService } from '../billing.service';
import { AccountPlanComponent } from '../sections/account-plan/account-plan.component';

@Component({ standalone: true, imports: [RouterOutlet], template: '<nav>Workspace navigation</nav><router-outlet />' })
class TestShell {}

@Component({ standalone: true, template: '<h1>Account settings</h1>' })
class TestDestination {}

describe('in-app pricing navigation', () => {
    const authenticated = signal(true);
    const startCheckout = vi.fn();
    const shell = routes.find(route => route.children)!;
    const pricingRoute = shell.children!.find(route => route.path === 'account/pricing')!;

    beforeEach(() => {
        authenticated.set(true);
        startCheckout.mockReset();
        TestBed.configureTestingModule({ providers: [
            provideRouter([
                { path: '', component: TestShell, children: [
                    pricingRoute,
                    { path: 'account/plan', component: TestDestination },
                ] },
                { path: 'login', component: TestDestination },
            ]),
            { provide: AuthService, useValue: {
                isAuthenticated: authenticated, authReady: Promise.resolve(),
                plan: signal('free'), discordReauthRequired: signal(false),
            } },
            { provide: BillingService, useValue: { startCheckout, loadBilling: vi.fn().mockResolvedValue(null) } },
            { provide: AccountService, useValue: { loadPlanSources: vi.fn().mockResolvedValue({}) } },
        ] });
    });

    it('keeps the pricing comparison under the shell with an explicit return to billing', async () => {
        expect(pricingRoute.canActivate).toContain(signedInGuard);
        const harness = await RouterTestingHarness.create('/account/pricing');
        const el = harness.routeNativeElement!;
        expect(el.textContent).toContain('Workspace navigation');
        expect(el.querySelector('h1')?.textContent).toBe('Plans & pricing');
        expect(el.querySelector('.pricing--embedded')).not.toBeNull();
        expect(el.querySelectorAll('.pricing-card')).toHaveLength(2);
        expect(el.querySelector('.pricing__head')).toBeNull();

        el.querySelector<HTMLAnchorElement>('.account-pricing__back')!.click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe('/account/plan');
        expect(harness.routeNativeElement!.textContent).toContain('Workspace navigation');
        expect(startCheckout).not.toHaveBeenCalled();
    });

    it('requires sign-in for direct pricing links, including guest demo visitors', async () => {
        authenticated.set(false);
        await RouterTestingHarness.create('/account/pricing');
        expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Faccount%2Fpricing');
        expect(startCheckout).not.toHaveBeenCalled();
    });

    it('links See pricing from account settings to the in-app page', async () => {
        const fixture = TestBed.createComponent(AccountPlanComponent);
        await fixture.whenStable();
        const links = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('a'));
        expect(links.find(link => link.textContent?.trim() === 'See pricing')?.getAttribute('href'))
            .toBe('/account/pricing');
        expect(fixture.nativeElement.querySelector('#billing')).not.toBeNull();
        expect(startCheckout).not.toHaveBeenCalled();
    });

    it('scrolls the billing widget into the workspace viewport on return', async () => {
        TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { fragment: 'billing' } } });
        const fixture = TestBed.createComponent(AccountPlanComponent);
        const scroll = vi.fn();
        fixture.nativeElement.scrollIntoView = scroll;
        await fixture.whenStable();
        expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
    });
});
