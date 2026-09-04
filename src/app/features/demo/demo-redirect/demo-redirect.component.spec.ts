import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { vi } from 'vitest';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { DemoRedirectComponent } from './demo-redirect.component';

describe('demo destination', () => {
    const setup = (returnUrl?: string) => {
        const enter = vi.fn();
        const navigateByUrl = vi.fn();
        TestBed.configureTestingModule({ providers: [
            { provide: DemoModeService, useValue: { enter } },
            { provide: Router, useValue: { navigateByUrl } },
            { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnUrl }) } } },
        ] });
        TestBed.runInInjectionContext(() => new DemoRedirectComponent()).ngOnInit();
        return { enter, navigateByUrl };
    };
    it('opens the requested journal page on the first click', () => {
        const { enter, navigateByUrl } = setup('/journal/daily');
        expect(enter).toHaveBeenCalledOnce();
        expect(navigateByUrl).toHaveBeenCalledWith('/journal/daily', { replaceUrl: true });
    });
    it.each([undefined, '/demo', '//example.invalid', 'https://example.invalid', '/auth/callback'])(
        'falls back to Dashboard for an unsafe or missing destination: %s', returnUrl => {
            const { navigateByUrl } = setup(returnUrl);
            expect(navigateByUrl).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
        },
    );
});
