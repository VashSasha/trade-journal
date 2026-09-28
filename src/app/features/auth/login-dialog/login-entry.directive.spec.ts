import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { LoginEntryDirective } from './login-entry.directive';
import { LoginDialogService } from './login-dialog.service';

@Component({ standalone: true, imports: [LoginEntryDirective], template: '<a appLoginEntry>Log in</a>' })
class LoginLinkHost {}

describe('login links', () => {
    it('opens the dialog on a normal click and preserves a real href for new tabs', async () => {
        const open = vi.fn();
        TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LoginDialogService, useValue: { open } }] });
        const fixture = TestBed.createComponent(LoginLinkHost);
        await fixture.whenStable();
        const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a');
        expect(link.getAttribute('href')).toBe('/login?returnUrl=%2Fdashboard');
        link.click();
        expect(open).toHaveBeenCalledExactlyOnceWith('/dashboard');
        const modified = new MouseEvent('click', { ctrlKey: true, cancelable: true });
        fixture.debugElement.children[0].injector.get(LoginEntryDirective).open(modified);
        expect(modified.defaultPrevented).toBe(false);
        expect(open).toHaveBeenCalledOnce();
    });

    it('uses the route outside the landing page', async () => {
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        const fixture = TestBed.createComponent(LoginLinkHost);
        await fixture.whenStable();
        fixture.nativeElement.querySelector('a').click();
        expect(navigate).toHaveBeenCalledWith('/login?returnUrl=%2Fdashboard');
    });
});
