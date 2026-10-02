import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserSessionService } from '../../core/services/user-session.service';
import { AiCoachingSettingsService } from './ai-coaching-settings.service';
import { CoachingToneComponent } from './coaching-tone.component';
import { AiCoachingBadgeComponent } from './ai-coaching-badge.component';

describe('Unhinged Coach consent UI', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup() {
        const userId = signal('A'), demo = signal(false), ai = signal(true), enabled = signal(false);
        const settings = { enabled, active: enabled, ready: signal(true), loading: signal(false), saving: signal(false), error: signal<string | null>(null),
            access: { demo, canAct: () => ai() }, load: vi.fn(async () => {}),
            setUnhinged: vi.fn(async (value: boolean, _accepted?: boolean) => { enabled.set(value); return true; }) };
        TestBed.configureTestingModule({ providers: [provideRouter([]),
            { provide: AiCoachingSettingsService, useValue: settings }, { provide: UserSessionService, useValue: { userId } }] });
        const fixture = TestBed.createComponent(CoachingToneComponent); fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        return { fixture, root, component: fixture.componentInstance, settings, userId, demo, ai,
            toggle: root.querySelector<HTMLButtonElement>('[role="switch"]')! };
    }

    it('requires the unchecked disclaimer before an explicit enable, then allows immediate disable', async () => {
        const { fixture, root, component, settings, toggle } = setup();
        expect(toggle.getAttribute('aria-checked')).toBe('false'); toggle.click(); fixture.detectChanges();
        const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        const enable = root.querySelector<HTMLButtonElement>('.coaching-tone__enable')!;
        expect(checkbox.checked).toBe(false); expect(enable.disabled).toBe(true);
        await component.confirm(); expect(settings.setUnhinged).not.toHaveBeenCalled();
        checkbox.click(); fixture.detectChanges(); expect(enable.disabled).toBe(false);
        await component.confirm(); fixture.detectChanges();
        expect(settings.setUnhinged).toHaveBeenCalledWith(true, true);
        expect(toggle.getAttribute('aria-checked')).toBe('true'); expect(root.querySelector('input')).toBeNull();
        await component.requestToggle(); expect(settings.setUnhinged).toHaveBeenLastCalledWith(false);
    });

    it('Escape cancels without saving and switching users clears the acknowledgement', () => {
        const { fixture, root, component, userId, settings, toggle } = setup();
        toggle.click(); fixture.detectChanges(); component.accepted.set(true);
        root.querySelector('.coaching-tone__consent')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
        expect(component.confirming()).toBe(false); expect(component.accepted()).toBe(false); expect(settings.setUnhinged).not.toHaveBeenCalled();
        toggle.click(); fixture.detectChanges(); component.accepted.set(true);
        userId.set('B'); fixture.detectChanges(); expect(component.confirming()).toBe(false); expect(component.accepted()).toBe(false);
    });

    it('shows failures and cannot cancel a committed opt-in mid-save or enable without AI access', async () => {
        const { fixture, root, component, settings, toggle, ai } = setup();
        toggle.click(); fixture.detectChanges(); settings.saving.set(true); fixture.detectChanges();
        component.cancel(); expect(component.confirming()).toBe(true); expect(toggle.disabled).toBe(true);
        settings.saving.set(false); component.accepted.set(true);
        settings.setUnhinged.mockImplementationOnce(async () => { settings.error.set('Could not confirm'); return false; });
        await component.confirm(); fixture.detectChanges(); expect(root.querySelector('[role="alert"]')!.textContent).toContain('Could not confirm');
        component.cancel(); ai.set(false); fixture.detectChanges(); expect(toggle.disabled).toBe(true);
        await component.requestToggle(); expect(component.confirming()).toBe(false);
    });

    it('marks the current mode with text, not color alone, and links to its settings', () => {
        const { settings } = setup();
        const badge = TestBed.createComponent(AiCoachingBadgeComponent); badge.detectChanges();
        expect(badge.nativeElement.querySelector('a')).toBeNull();
        settings.enabled.set(true); badge.detectChanges();
        const link = badge.nativeElement.querySelector('a') as HTMLAnchorElement;
        expect(link.textContent).toContain('Unhinged mode'); expect(link.getAttribute('href')).toBe('/account/ai');
    });
});
