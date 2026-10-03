import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { GettingStartedComponent } from './getting-started.component';
import { parseOnboardingProgress } from './onboarding.model';
import { OnboardingService } from './onboarding.service';

function setup(compact = false) {
    const paid = signal(false), ai = signal(false), demo = signal(false);
    const state = {
        progress: signal(parseOnboardingProgress(null)), ready: signal(true), loading: signal(false), saving: signal(false),
        complete: signal(false), completedCount: signal(0), hasTrades: signal(false), dataLoaded: signal(true),
        showInvitation: signal(true), error: signal<string | null>(null), update: vi.fn(), load: vi.fn(), openGuide: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [
        provideRouter([]),
        { provide: OnboardingService, useValue: state },
        { provide: AccessPolicyService, useValue: { demo, canOpen: (feature: string) => feature === 'ai' ? ai() : paid() } },
    ] });
    const fixture = TestBed.createComponent(GettingStartedComponent);
    fixture.componentRef.setInput('compact', compact); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { state, paid, ai, demo, root, fixture };
}

afterEach(() => TestBed.resetTestingModule());

describe('getting started UI', () => {
    it('offers manual entry to free users without sending them to guarded broker screens', () => {
        const { root, state } = setup();
        expect(root.querySelector('a[href="/journal/trade/new"]')).not.toBeNull();
        expect(root.querySelector('a[href="/account/integrations"]')).toBeNull();
        expect(root.querySelector('a[href="/account/pricing"]')).not.toBeNull();
        expect(root.textContent).not.toContain('You also have AI Coach access');
        expect(state.update).not.toHaveBeenCalled();
    });

    it('links existing broker and alert screens and shows Coach guidance only with AI access', () => {
        const { root, paid, ai, fixture } = setup(); paid.set(true); fixture.detectChanges();
        expect(root.querySelector('a[href="/account/integrations"]')).not.toBeNull();
        expect(root.querySelector('a[href="/account/alerts"]')).not.toBeNull();
        expect(root.querySelector('a[href="/account/pricing"]')).toBeNull();
        expect(root.querySelector('a[href="/account/ai"]')).toBeNull();
        ai.set(true); fixture.detectChanges(); expect(root.querySelector('a[href="/account/ai"]')).not.toBeNull();
        expect(root.querySelector('a[href="/journal/daily?setup=templates"]')).not.toBeNull();
        expect(root.querySelectorAll('ol > li')).toHaveLength(4);
    });

    it('requires review confirmation and does not falsely tick a failed save', () => {
        const { root, state, fixture } = setup();
        const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        checkbox.click(); fixture.detectChanges();
        expect(state.update).toHaveBeenCalledExactlyOnceWith({ started: true, accountsReviewed: true });
        expect(checkbox.checked).toBe(false);
        state.progress.set({ ...state.progress(), accountsReviewed: true }); fixture.detectChanges();
        expect(checkbox.checked).toBe(true);
        state.saving.set(true); fixture.detectChanges(); expect(checkbox.disabled).toBe(true);
    });

    it('keeps the invitation compact, dismissible, and removable without leaving an empty card', () => {
        const { root, state, fixture } = setup(true);
        expect(root.querySelector('ol')).toBeNull();
        root.querySelector('button')!.click(); expect(state.openGuide).toHaveBeenCalledOnce();
        root.querySelectorAll('button')[1].click(); expect(state.update).toHaveBeenCalledWith({ dismissed: true });
        state.showInvitation.set(false); fixture.detectChanges(); expect(root.querySelector('section')).toBeNull();
    });

    it('has non-blocking demo, loading and failed-load states with retry', () => {
        const { root, state, demo, fixture } = setup();
        demo.set(true); fixture.detectChanges(); expect(root.querySelector('input')).toBeNull();
        expect(root.textContent).toContain('exploring demo');
        demo.set(false); state.ready.set(false); fixture.detectChanges(); expect(root.textContent).toContain('Loading your setup');
        state.error.set('Couldn’t load setup progress.'); fixture.detectChanges();
        expect(root.querySelector('[role="alert"]')).not.toBeNull();
        root.querySelector('button')!.click(); expect(state.load).toHaveBeenCalledOnce();
    });
});
