import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { AuthCallbackComponent } from './auth-callback.component';

describe('OAuth return navigation', () => {
    function setup(params: Record<string, string>, hasSession = true) {
        const completeOAuth = vi.fn().mockResolvedValue(undefined);
        TestBed.configureTestingModule({ providers: [provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
            { provide: AuthService, useValue: { authReady: Promise.resolve(), session: () => hasSession ? {} : null, completeOAuth } },
        ] });
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        return { fixture: TestBed.createComponent(AuthCallbackComponent), navigate, completeOAuth };
    }
    it('restores the exact plan and billing interval without starting checkout', async () => {
        const returnUrl = '/account/pricing?plan=premium_plus&interval=annual';
        const { fixture, navigate, completeOAuth } = setup({ returnUrl });
        await fixture.componentInstance.ngOnInit();
        expect(completeOAuth).toHaveBeenCalledOnce();
        expect(navigate).toHaveBeenCalledExactlyOnceWith(returnUrl, { replaceUrl: true });
    });
    it('keeps intent in the retry link when a provider rejects sign-in', async () => {
        const { fixture, navigate, completeOAuth } = setup({ returnUrl: '/account/pricing?plan=premium&interval=annual', error: 'access_denied' });
        await fixture.whenStable();
        expect(fixture.nativeElement.textContent).toContain('access_denied');
        const href = fixture.nativeElement.querySelector('a').getAttribute('href');
        expect(new URL(href, 'https://nvzn.invalid').searchParams.get('returnUrl')).toBe('/account/pricing?plan=premium&interval=annual');
        expect(navigate).not.toHaveBeenCalled();
        expect(completeOAuth).not.toHaveBeenCalled();
    });
    it('never navigates to an external return destination', async () => {
        const { fixture, navigate } = setup({ returnUrl: 'https://example.com' });
        await fixture.componentInstance.ngOnInit();
        expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    });
    it('does not enter the app when a callback has no session', async () => {
        const { fixture, navigate } = setup({}, false);
        await fixture.componentInstance.ngOnInit();
        expect(fixture.componentInstance.error()).toContain('no session');
        expect(navigate).not.toHaveBeenCalled();
    });
});
