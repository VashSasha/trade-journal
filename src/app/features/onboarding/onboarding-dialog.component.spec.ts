import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { DemoModeService } from '../../core/services/demo-mode.service';
import { OnboardingDialogComponent } from './onboarding-dialog.component';
import { OnboardingService } from './onboarding.service';
import { parseOnboardingProgress } from './onboarding.model';

describe('getting started dialog', () => {
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    beforeEach(() => {
        Object.defineProperties(HTMLDialogElement.prototype, {
            showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } },
            close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } },
        });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
        else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
        if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
        else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    });
    function setup(offer = false) {
        const state = {
            dialogOpen: signal(false), shouldOfferGuide: signal(offer), complete: signal(false), ready: signal(true),
            progress: signal(parseOnboardingProgress(null)), completedCount: signal(0), hasTrades: signal(false),
            saving: signal(false), error: signal(null), update: vi.fn(),
            openGuide: vi.fn(() => { state.shouldOfferGuide.set(false); state.dialogOpen.set(true); }),
            closeGuide: vi.fn(() => state.dialogOpen.set(false)),
        };
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: OnboardingService, useValue: state },
            { provide: DemoModeService, useValue: { transitioning: signal(false), enter: vi.fn() } },
            { provide: AccessPolicyService, useValue: { demo: signal(false), canOpen: () => true } },
        ] });
        const fixture = TestBed.createComponent(OnboardingDialogComponent);
        const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
        return { state, fixture, dialog };
    }

    it('automatically shows the four-step guide once for an eligible newcomer', async () => {
        const { state, fixture, dialog } = setup(true); await fixture.whenStable();
        expect(state.openGuide).toHaveBeenCalledOnce(); expect(dialog.open).toBe(true);
        expect(dialog.querySelectorAll('ol > li')).toHaveLength(4);
        expect(dialog.getAttribute('aria-labelledby')).toBe('setup-dialog-title');
        dialog.dispatchEvent(new Event('cancel')); await fixture.whenStable();
        expect(dialog.open).toBe(false); expect(state.openGuide).toHaveBeenCalledOnce();
    });

    it('closes on backdrop, not on content, and restores scrolling', async () => {
        const { state, fixture, dialog } = setup(); const overflow = document.documentElement.style.overflow;
        state.openGuide(); await fixture.whenStable();
        expect(document.documentElement.style.overflow).toBe('hidden');
        dialog.querySelector<HTMLElement>('.setup-dialog__body')!.click(); expect(state.dialogOpen()).toBe(true);
        dialog.click(); await fixture.whenStable();
        expect(dialog.open).toBe(false); expect(document.documentElement.style.overflow).toBe(overflow);
    });

    it('hides after following an action without dismissing the remaining checklist', async () => {
        const { state, fixture, dialog } = setup(); state.openGuide(); await fixture.whenStable();
        const link = dialog.querySelector('a')!;
        fixture.componentInstance.followLink({ target: link } as unknown as MouseEvent);
        expect(state.closeGuide).toHaveBeenLastCalledWith(false);
        await fixture.whenStable(); expect(dialog.open).toBe(false);
    });

    it('does not open for ineligible users and cleans up on destroy', async () => {
        const { state, fixture, dialog } = setup(); await fixture.whenStable(); expect(dialog.open).toBe(false);
        const overflow = document.documentElement.style.overflow;
        state.openGuide(); await fixture.whenStable(); fixture.destroy();
        expect(document.documentElement.style.overflow).toBe(overflow);
    });
});
