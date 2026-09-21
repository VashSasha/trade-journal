import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/services/auth.service';
import { BillingService } from '../../../account/billing.service';
import { LandingPricingComponent } from './landing-pricing.component';

describe('shared pricing cards', () => {
    const plan = signal('free');
    const startCheckout = vi.fn();
    const loadBilling = vi.fn();
    const openPortal = vi.fn();

    beforeEach(() => {
        plan.set('free');
        loadBilling.mockReset().mockResolvedValue(null);
        openPortal.mockReset().mockResolvedValue({ error: 'Portal unavailable' });
        startCheckout.mockReset().mockResolvedValue({ error: 'Checkout unavailable' });
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: AuthService, useValue: { plan, aiAccess: computed(() => ['premium_plus', 'admin'].includes(plan())), isAuthenticated: () => true } },
            { provide: BillingService, useValue: { startCheckout, loadBilling, openPortal } },
        ] });
    });

    it.each(['premium', 'premium_plus', 'lifetime', 'admin'])('sends existing %s members to billing, not another checkout', async tier => {
        plan.set(tier);
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        const fixture = TestBed.createComponent(LandingPricingComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('a[href="/account/plan"]')?.textContent).toBe('Manage plan & billing');
        expect(el.querySelector('.pricing-card')?.querySelector('button.pricing-card__cta')).toBeNull();
        await fixture.componentInstance.subscribe();
        expect(startCheckout).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(['/account/plan']);
    });

    it('keeps the annual price and selected checkout interval aligned in the embedded view', async () => {
        const fixture = TestBed.createComponent(LandingPricingComponent);
        fixture.componentRef.setInput('embedded', true);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        el.querySelectorAll<HTMLButtonElement>('.pricing-card__cycle-btn')[1].click();
        await fixture.whenStable();
        expect(el.querySelector('.pricing-card__per-day')?.textContent).toContain('$249.99 once a year');
        expect(el.querySelectorAll('.pricing-card__cycle-btn')[1].getAttribute('aria-pressed')).toBe('true');
        expect(startCheckout).not.toHaveBeenCalled();
        await fixture.componentInstance.subscribe();
        await fixture.whenStable();
        expect(startCheckout).toHaveBeenCalledExactlyOnceWith('annual', 'premium');
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('Checkout unavailable');
    });
    it('shows the Premium+ annual total and submits the correct tier', async () => {
        const fixture = TestBed.createComponent(LandingPricingComponent);
        fixture.componentInstance.selectCycle('annual');
        await fixture.whenStable();
        expect(fixture.nativeElement.textContent).toContain('$349.99 once a year');
        await fixture.componentInstance.subscribe('premium_plus');
        expect(startCheckout).toHaveBeenCalledExactlyOnceWith('annual', 'premium_plus');
    });

    it('routes a subscribed Premium upgrade to the portal instead of duplicate checkout', async () => {
        plan.set('premium');
        loadBilling.mockResolvedValue({ stripeSubscriptionId: 'sub_existing', status: 'active' });
        const fixture = TestBed.createComponent(LandingPricingComponent);
        await fixture.componentInstance.subscribe('premium_plus');
        expect(openPortal).toHaveBeenCalledOnce();
        expect(startCheckout).not.toHaveBeenCalled();
    });

    it('allows a Lifetime member without a Stripe subscription to buy Premium+', async () => {
        plan.set('lifetime');
        const fixture = TestBed.createComponent(LandingPricingComponent);
        await fixture.componentInstance.subscribe('premium_plus');
        expect(startCheckout).toHaveBeenCalledExactlyOnceWith('monthly', 'premium_plus');
    });

    it('clears busy state after an unexpected billing failure', async () => {
        loadBilling.mockRejectedValue(new Error('offline'));
        const fixture = TestBed.createComponent(LandingPricingComponent);
        await fixture.componentInstance.subscribe('premium_plus');
        expect(fixture.componentInstance.checkoutBusy()).toBeNull();
        expect(fixture.componentInstance.checkoutError()).toContain('try again');
        expect(startCheckout).not.toHaveBeenCalled();
    });
});
