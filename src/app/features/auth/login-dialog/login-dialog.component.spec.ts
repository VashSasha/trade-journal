import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../core/services/auth.service';
import { LoginDialogComponent } from './login-dialog.component';
import { LoginDialogService } from './login-dialog.service';

describe('landing login dialog', () => {
    const authenticated = signal(false);
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    beforeEach(() => {
        authenticated.set(false);
        // jsdom does not implement the native dialog methods; browser checks cover focus behavior.
        Object.defineProperties(HTMLDialogElement.prototype, {
            showModal: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }) },
            close: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); }) },
        });
        TestBed.configureTestingModule({ providers: [provideRouter([]), LoginDialogService,
            { provide: AuthService, useValue: { isAuthenticated: authenticated } },
        ] });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        vi.restoreAllMocks();
        if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
        else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
        if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
        else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    });

    it('opens the shared panel, locks background scroll, and cleans up on Escape', async () => {
        const fixture = TestBed.createComponent(LoginDialogComponent);
        const state = TestBed.inject(LoginDialogService);
        const previousOverflow = document.documentElement.style.overflow;
        state.open('/account/pricing?plan=premium_plus&interval=annual');
        await fixture.whenStable();
        const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
        expect(dialog.open).toBe(true);
        expect(dialog.getAttribute('aria-labelledby')).toBe('login-title');
        expect(fixture.nativeElement.textContent).toContain('Premium+ · Annual');
        expect(document.documentElement.style.overflow).toBe('hidden');
        dialog.dispatchEvent(new Event('cancel'));
        await fixture.whenStable();
        expect(dialog.open).toBe(false);
        expect(state.request()).toBeNull();
        expect(document.documentElement.style.overflow).toBe(previousOverflow);
    });

    it('closes when the backdrop is clicked, not when panel content is clicked', async () => {
        const fixture = TestBed.createComponent(LoginDialogComponent);
        const state = TestBed.inject(LoginDialogService);
        state.open();
        await fixture.whenStable();
        fixture.nativeElement.querySelector('.login-dialog__content').click();
        expect(state.request()).not.toBeNull();
        fixture.nativeElement.querySelector('dialog').click();
        await fixture.whenStable();
        expect(state.request()).toBeNull();
    });

    it('uses the full-screen route on phones and preserves the destination', () => {
        const match = window.matchMedia;
        vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...match(query), matches: true }));
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        const state = TestBed.inject(LoginDialogService);
        state.open('/account/pricing?plan=premium_plus&interval=annual');
        expect(state.request()).toBeNull();
        expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/account/pricing?plan=premium_plus&interval=annual' } });
    });

    it('wraps keyboard navigation at both ends of the dialog', async () => {
        const fixture = TestBed.createComponent(LoginDialogComponent);
        TestBed.inject(LoginDialogService).open();
        await fixture.whenStable();
        const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
        for (const button of buttons) vi.spyOn(button, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        last.focus();
        const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
        fixture.componentInstance.containTab(forward);
        expect(forward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
        fixture.componentInstance.containTab(backward);
        expect(backward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });

    it('restores scrolling when navigation destroys an open dialog', async () => {
        const fixture = TestBed.createComponent(LoginDialogComponent);
        const previous = document.documentElement.style.overflow;
        TestBed.inject(LoginDialogService).open();
        await fixture.whenStable();
        expect(document.documentElement.style.overflow).toBe('hidden');
        fixture.destroy();
        expect(document.documentElement.style.overflow).toBe(previous);
    });

    it('handles a session restored in another tab without another provider login', async () => {
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        const fixture = TestBed.createComponent(LoginDialogComponent);
        const state = TestBed.inject(LoginDialogService);
        state.open('/account/pricing?plan=premium&interval=monthly');
        await fixture.whenStable();
        authenticated.set(true);
        await fixture.whenStable();
        expect(state.request()).toBeNull();
        expect(navigate).toHaveBeenCalledWith('/account/pricing?plan=premium&interval=monthly');
        expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    });
});
