import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { DemoBannerComponent } from './demo-banner.component';
import { DemoModeService } from '../../../core/services/demo-mode.service';
import { AuthService } from '../../../core/services/auth.service';
import { AccessPolicyService } from '../../../core/services/access-policy.service';

describe('demo broker CTA', () => {
    it.each(['guest', 'free', 'premium', 'lifetime'])('routes %s to the appropriate next step', tier => {
        const navigate = vi.fn(); const exit = vi.fn();
        TestBed.configureTestingModule({ providers: [
            { provide: Router, useValue: { navigate } },
            { provide: AuthService, useValue: { isAuthenticated: () => tier !== 'guest' } },
            { provide: AccessPolicyService, useValue: { paid: () => ['premium', 'lifetime'].includes(tier) } },
            { provide: DemoModeService, useValue: { exit } },
        ] });
        TestBed.runInInjectionContext(() => new DemoBannerComponent()).primaryAction();
        if (tier === 'guest') expect(navigate).toHaveBeenCalledWith(['/login']);
        else if (tier === 'free') expect(navigate).toHaveBeenCalledWith(['/upgrade'], { queryParams: { feature: 'broker' } });
        else expect(exit).toHaveBeenCalledWith('/account/integrations');
        if (tier === 'guest' || tier === 'free') expect(exit).not.toHaveBeenCalled();
    });
});
