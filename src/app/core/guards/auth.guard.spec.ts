import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot } from '@angular/router';
import { signedInGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { routes } from '../../app.routes';

describe('free journal and personal account access', () => {
    it('keeps basic daily journaling outside the paid guards', () => {
        const shell = routes.find(route => route.children);
        const journal = shell?.children?.find(route => route.path === 'journal');
        const daily = journal?.children?.find(route => route.path === 'daily');
        expect(daily).toBeDefined();
        expect(daily?.canActivate).toBeUndefined();
        expect(shell?.canActivate?.length).toBeGreaterThan(0);
    });
    it('requires a real login for account/security/billing even when a guest is in demo', async () => {
        TestBed.configureTestingModule({ providers: [provideRouter([]),
            { provide: AuthService, useValue: { authReady: Promise.resolve(), isAuthenticated: () => false } },
        ] });
        const result = await TestBed.runInInjectionContext(() => signedInGuard(
            {} as ActivatedRouteSnapshot, { url: '/account' } as RouterStateSnapshot
        ));
        expect(result.toString()).toBe('/login?returnUrl=%2Faccount');
    });
});
