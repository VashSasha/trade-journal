import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { LoginComponent } from './login';

describe('shared login panel and page', () => {
    const google = vi.fn();
    const discord = vi.fn();
    function setup(returnUrl = '/dashboard', reason = '') {
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { queryParams: { returnUrl, reason } } } },
            { provide: AuthService, useValue: { isAuthenticated: signal(false), loginWithGoogle: google, loginWithDiscord: discord } },
            { provide: ThemeService, useValue: { isDark: signal(true), toggle: vi.fn() } },
        ] });
        return TestBed.createComponent(LoginComponent);
    }
    beforeEach(() => { google.mockReset().mockResolvedValue(undefined); discord.mockReset().mockResolvedValue(undefined); });

    it('keeps the chosen plan visible and passes it through the Google redirect', async () => {
        const destination = '/account/pricing?plan=premium_plus&interval=annual';
        const fixture = setup();
        fixture.componentRef.setInput('embedded', true);
        fixture.componentRef.setInput('returnTo', destination);
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('app-public-nav')).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Premium+ · Annual');
        expect(fixture.nativeElement.textContent).toContain('$349.99 / year');
        expect(fixture.nativeElement.textContent).toContain('No charge at this step.');
        await fixture.componentInstance.loginWithGoogle();
        expect(google).toHaveBeenCalledExactlyOnceWith(destination);
    });

    it('keeps the route fallback and gives an expired-session explanation', async () => {
        const fixture = setup('/journal/daily', 'session-expired');
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('app-public-nav')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('session has expired');
        await fixture.componentInstance.loginWithDiscord();
        expect(discord).toHaveBeenCalledExactlyOnceWith('/journal/daily');
    });

    it('uses a safe destination for malicious login links', async () => {
        const fixture = setup('//example.com');
        await fixture.componentInstance.loginWithDiscord();
        expect(discord).toHaveBeenCalledExactlyOnceWith('/dashboard');
    });

    it('prevents duplicate provider requests while a redirect starts', async () => {
        const fixture = setup();
        await fixture.componentInstance.loginWithGoogle();
        await fixture.componentInstance.loginWithGoogle();
        await fixture.componentInstance.loginWithDiscord();
        expect(google).toHaveBeenCalledOnce();
        expect(discord).not.toHaveBeenCalled();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelectorAll('button:disabled').length).toBe(2);
    });

    it('shows a failed provider request and allows retrying without losing the selection', async () => {
        google.mockRejectedValueOnce(new Error('Connection interrupted. Try again.'));
        const destination = '/account/pricing?plan=premium&interval=monthly';
        const fixture = setup(destination);
        await fixture.componentInstance.loginWithGoogle();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Connection interrupted');
        expect(fixture.componentInstance.busy()).toBe(false);
        await fixture.componentInstance.loginWithDiscord();
        expect(discord).toHaveBeenCalledExactlyOnceWith(destination);
    });
});
