import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/services/auth.service';
import { BillingService } from '../../../account/billing.service';
import { LandingPricingComponent } from './landing-pricing.component';

describe('shared pricing cards', () => {
    const plan = signal('free');
    const startCheckout = vi.fn();

    beforeEach(() => {
        plan.set('free');
        startCheckout.mockReset().mockResolvedValue({ error: 'Checkout unavailable' });
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: AuthService, useValue: { plan, isAuthenticated: () => true } },
            { provide: BillingService, useValue: { startCheckout } },
        ] });
    });

    it.each(['premium', 'lifetime', 'admin'])('sends existing %s members to billing, not another checkout', async tier => {
        plan.set(tier);
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        const fixture = TestBed.createComponent(LandingPricingComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('a[href="/account#billing"]')?.textContent).toBe('Manage plan & billing');
        expect(el.querySelector('button.pricing-card__cta')).toBeNull();
        await fixture.componentInstance.subscribe();
        expect(startCheckout).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(['/account'], { fragment: 'billing' });
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
        expect(startCheckout).toHaveBeenCalledExactlyOnceWith('annual');
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('Checkout unavailable');
    });
});
