import { computed, signal } from '@angular/core';
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
            status: signal({ label: 'Off', detail: 'Sounds are turned off.' }),
            toggle: vi.fn(), enable: vi.fn(), mute: vi.fn(), preview: vi.fn(), setVolume: vi.fn(), setKind: vi.fn(),
        };
        TestBed.configureTestingModule({ providers: [{ provide: SessionAlertsService, useValue: sounds }] });
        Object.assign(sounds, { toggleLabel: computed(() => sounds.enabled() ? 'Mute all sounds' : 'Enable all sounds') });
        const fixture = TestBed.createComponent(SessionAlertControlsComponent);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const button = (label: string) => [...element.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
        return { sounds, fixture, element, button };
    }
    it('renders independently without owning playback lifetime and requires explicit opt-in', () => {
        const { sounds, element, button } = setup();
        expect(sounds.attach).not.toHaveBeenCalled();
        expect(element.querySelector('details')?.open).toBe(false);
        expect(sounds.enable).not.toHaveBeenCalled();
        button('Enable all sounds').click(); expect(sounds.toggle).toHaveBeenCalledOnce();
    });
    it('shows the saved ready state until the first post-refresh interaction', () => {
        const { sounds, fixture, element, button } = setup();
        sounds.waitingForGesture.set(true);
        sounds.status.set({ label: 'Ready', detail: 'Waiting for your first click' }); fixture.detectChanges();
        expect(element.querySelector('summary')?.textContent).toContain('Ready');
        expect(element.textContent).toContain('Waiting for your first click');
        expect(button('Enable all sounds')).toBeTruthy();
    });
    it('keeps bell toggles out of master sound settings', () => {
        const { fixture, element, button, sounds } = setup();
        sounds.enabled.set(true);
        fixture.componentRef.setInput('section', 'master');
        fixture.detectChanges();
        expect(element.querySelectorAll('[type="checkbox"]')).toHaveLength(0);
        expect(element.querySelector('[type="range"]')).not.toBeNull();
        button('Test sound').click();
        expect(sounds.preview).toHaveBeenCalledWith('open');
    });
    it('shows only bell settings and previews when embedded with sessions', () => {
        const { fixture, element, button, sounds } = setup();
        fixture.componentRef.setInput('section', 'bells');
        fixture.detectChanges();
        expect(element.querySelectorAll('[type="checkbox"]')).toHaveLength(2);
        expect(element.querySelector('[type="range"]')).toBeNull();
        expect(button('Enable all sounds')).toBeUndefined();
        expect(button('Test opening bell').disabled).toBe(true);
        expect(element.textContent).toContain('Enable sounds in the Sound section');
        sounds.enabled.set(true); fixture.detectChanges();
        button('Test opening bell').click();
        expect(sounds.preview).toHaveBeenCalledWith('open');
        expect(element.textContent).toContain('Sounds are active');
    });
    it('exposes mute and blocks test-button spam while playing', () => {
        const { sounds, fixture, button } = setup();
        sounds.enabled.set(true); fixture.detectChanges();
        button('Test closing bell').click(); expect(sounds.preview).toHaveBeenCalledWith('close');
        sounds.enabled.set(true); sounds.state.set('on'); sounds.previewing.set(true); fixture.detectChanges();
        expect(button('Test opening bell').disabled).toBe(true);
        button('Mute all sounds').click(); expect(sounds.toggle).toHaveBeenCalledOnce();
    });
    it('provides accessible volume/type inputs and forwards only their values', () => {
        const { sounds, element } = setup();
        const volume = element.querySelector<HTMLInputElement>('[type="range"]')!;
        expect(volume.getAttribute('aria-label')).toBe('Master sound volume');
        volume.value = '60'; volume.dispatchEvent(new Event('input'));
        expect(sounds.setVolume).toHaveBeenCalledWith(60);
        const opens = element.querySelector<HTMLInputElement>('[type="checkbox"]')!;
        opens.checked = false; opens.dispatchEvent(new Event('change'));
        expect(sounds.setKind).toHaveBeenCalledWith('open', false);
    });
    it('explains an unsupported browser and disables enable', () => {
        const { element, button } = setup(false);
        expect(button('Enable all sounds').disabled).toBe(true);
        expect(element.textContent).toContain('supported browser');
    });
    it('announces errors and explains zero-volume mode', () => {
        const { sounds, fixture, element, button } = setup();
        sounds.error.set('Audio was blocked.'); sounds.status.set({ label: 'Needs attention', detail: 'Audio was blocked.' });
        sounds.preferences.update(p => ({ ...p, volume: 0 })); fixture.detectChanges();
        expect(element.querySelector('[role="status"]')?.textContent).toContain('blocked');
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('blocked');
        expect(element.querySelector('summary')?.textContent).toContain('Needs attention');
        expect(button('Enable all sounds').disabled).toBe(false);
        expect(element.textContent).toContain('Increase volume');
    });
});
