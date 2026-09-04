import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { PublicNavComponent } from './public-nav.component';

@Component({ standalone: true, imports: [PublicNavComponent], template: '<app-public-nav [onLanding]="true" />' })
class TestLanding {}

describe('public navigation', () => {
    const authenticated = signal(false);

    beforeEach(() => {
        authenticated.set(false);
        TestBed.configureTestingModule({
            providers: [
                provideRouter([{ path: 'welcome', component: TestLanding }]),
                { provide: AuthService, useValue: { isAuthenticated: authenticated } },
                { provide: ThemeService, useValue: { isDark: signal(true), toggle: vi.fn() } },
            ],
        });
    });

    it('replaces signup links with a workspace link when the session is restored', async () => {
        const fixture = TestBed.createComponent(PublicNavComponent);
        fixture.componentRef.setInput('onLanding', true);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('Log in');
        expect(el.textContent).toContain('Get started');

        authenticated.set(true);
        await fixture.whenStable();
        expect(el.textContent).not.toContain('Log in');
        expect(el.textContent).not.toContain('Get started');
        expect(el.querySelector('.public-nav__cta')?.getAttribute('href')).toBe('/dashboard');
        expect(el.querySelector('.public-nav__cta')?.textContent).toBe('Back to journal');
        expect(el.querySelector('a[href="/#pricing"]')).not.toBeNull();
    });

    it('uses explicit website links and in-app pricing on non-landing pages when signed in', async () => {
        authenticated.set(true);
        const fixture = TestBed.createComponent(PublicNavComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('a[href="/welcome#features"]')).not.toBeNull();
        expect(el.querySelector('a[href="/account/pricing"]')).not.toBeNull();
        expect(el.querySelector('a[href="/#features"]')).toBeNull();
    });

    it('keeps pricing available to guests without sending them into the app', async () => {
        const fixture = TestBed.createComponent(PublicNavComponent);
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('a[href="/welcome#pricing"]')).not.toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Back to journal');
    });

    it('keeps signed-in visitors on /welcome when they follow section links', async () => {
        authenticated.set(true);
        const harness = await RouterTestingHarness.create('/welcome');
        const link = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('a[href="/welcome#pricing"]');
        expect(link).not.toBeNull();
        link!.click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe('/welcome#pricing');
    });
});
