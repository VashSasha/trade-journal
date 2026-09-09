import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SessionAlertControlsComponent } from './session-alert-controls.component';
import { SessionAlertsService } from './session-alerts.service';

describe('session sound controls', () => {
    function setup(supported = true) {
        const sounds = {
            attach: vi.fn(), supported, state: signal('off'), enabled: signal(false), waitingForGesture: signal(false), previewing: signal(false),
            preferences: signal({ volume: 45, opens: true, closes: true, armed: false }), lastAlert: signal<string | null>(null),
            error: signal<string | null>(null), preferencesLoading: signal(false), storageWarning: signal(false), syncWarning: signal(false),
            enable: vi.fn(), mute: vi.fn(), preview: vi.fn(), setVolume: vi.fn(), setKind: vi.fn(),
        };
        TestBed.configureTestingModule({ providers: [{ provide: SessionAlertsService, useValue: sounds }] });
        const fixture = TestBed.createComponent(SessionAlertControlsComponent);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const button = (label: string) => [...element.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
        return { sounds, fixture, element, button };
    }
    it('renders independently, registers lifecycle and requires explicit opt-in', () => {
        const { sounds, element, button } = setup();
        expect(sounds.attach).toHaveBeenCalledOnce();
        expect(element.querySelector('details')?.open).toBe(false);
        expect(sounds.enable).not.toHaveBeenCalled();
        button('Enable sounds').click(); expect(sounds.enable).toHaveBeenCalledOnce();
    });
    it('shows the saved ready state until the first post-refresh interaction', () => {
        const { sounds, fixture, element, button } = setup();
        sounds.waitingForGesture.set(true); fixture.detectChanges();
        expect(element.querySelector('summary')?.textContent).toContain('Ready');
        expect(element.textContent).toContain('Waiting for your first click');
        expect(button('Reactivate bells')).toBeTruthy();
    });
    it('exposes mute and blocks test-button spam while playing', () => {
        const { sounds, fixture, button } = setup();
        button('Test closing bell').click(); expect(sounds.preview).toHaveBeenCalledWith('close');
        sounds.enabled.set(true); sounds.state.set('on'); sounds.previewing.set(true); fixture.detectChanges();
        expect(button('Test opening bell').disabled).toBe(true);
        button('Mute').click(); expect(sounds.mute).toHaveBeenCalledOnce();
    });
    it('provides accessible volume/type inputs and forwards only their values', () => {
        const { sounds, element } = setup();
        const volume = element.querySelector<HTMLInputElement>('[type="range"]')!;
        expect(volume.getAttribute('aria-label')).toBe('Session sound volume');
        volume.value = '60'; volume.dispatchEvent(new Event('input'));
        expect(sounds.setVolume).toHaveBeenCalledWith(60);
        const opens = element.querySelector<HTMLInputElement>('[type="checkbox"]')!;
        opens.checked = false; opens.dispatchEvent(new Event('change'));
        expect(sounds.setKind).toHaveBeenCalledWith('open', false);
    });
    it('explains an unsupported browser and disables enable', () => {
        const { element, button } = setup(false);
        expect(button('Enable sounds').disabled).toBe(true);
        expect(element.textContent).toContain('supported browser');
    });
    it('announces errors and explains zero-volume mode', () => {
        const { sounds, fixture, element, button } = setup();
        sounds.error.set('Audio was blocked.'); sounds.preferences.update(p => ({ ...p, volume: 0 })); fixture.detectChanges();
        expect(element.querySelector('[role="status"]')?.textContent).toContain('blocked');
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('blocked');
        expect(element.querySelector('summary')?.textContent).toContain('Needs attention');
        expect(button('Enable sounds').disabled).toBe(true);
        expect(element.textContent).toContain('Increase volume');
    });
});
