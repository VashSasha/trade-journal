import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';
import { CustomAlertSoundControlsComponent } from './custom-alert-sound-controls.component';
import { emptyCustomAlertSoundMap } from './custom-alert-sounds.models';
import { SessionAlertsService } from './session-alerts.service';
import { AlertSoundKind, DEFAULT_SESSION_SOUNDS, SessionSoundPreferences } from './session-alerts.utils';
import { AlertSoundSelection } from './alert-sound-library';

describe('custom alert sound controls', () => {
    function setup() {
        const audio = {
            customSounds: signal(emptyCustomAlertSoundMap()), customSoundsLoading: signal(false),
            customSoundsError: signal<string | null>(null), customSoundStorageSupported: true,
            presetSoundsLoading: signal(false), presetSoundsError: signal<string | null>(null),
            installCustomSound: vi.fn(async (kind: string, file: File) => ({
                kind, name: file.name, mimeType: file.type, size: file.size,
                duration: 1.2, updatedAt: '2026-09-06T00:00:00.000Z',
            })),
            removeCustomSound: vi.fn(async () => {}),
        };
        const preferences = signal<SessionSoundPreferences>({ ...DEFAULT_SESSION_SOUNDS });
        const sounds = {
            enabled: signal(true), previewing: signal(false), state: signal('off'), preferences, preview: vi.fn(async () => {}),
            preferencesLoading: signal(false), syncWarning: signal(false), error: signal(null),
            setSound: vi.fn((kind: AlertSoundKind, choice: AlertSoundSelection) => preferences.update(p => ({
                ...p, selections: { ...p.selections, [kind]: choice },
            }))),
        };
        TestBed.configureTestingModule({ providers: [
            { provide: AlertAudioService, useValue: audio },
            { provide: SessionAlertsService, useValue: sounds },
        ] });
        const fixture = TestBed.createComponent(CustomAlertSoundControlsComponent);
        fixture.detectChanges();
        return { audio, sounds, fixture, element: fixture.nativeElement as HTMLElement };
    }

    it('renders all semantic cues with upload and preview controls', () => {
        const { element } = setup();
        expect(element.querySelectorAll('.custom-sound')).toHaveLength(14);
        expect(element.querySelector('details')).toBeNull();
        expect(element.textContent).not.toContain('Default cues');
        expect(element.textContent).not.toContain('Target default');
        expect(element.textContent).not.toContain('Warning default');
        expect(element.textContent).toContain('Session opening');
        expect(element.textContent).toContain('Daily profit target');
        expect(element.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toContain('.mp3');
    });

    it('installs and previews the selected cue', async () => {
        const { audio, sounds, fixture, element } = setup();
        const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
        const file = new File(['sound'], 'my-bell.mp3', { type: 'audio/mpeg' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new Event('change'));
        await fixture.whenStable();
        fixture.detectChanges();

        expect(audio.installCustomSound).toHaveBeenCalledWith('open', file);
        expect(sounds.preview).toHaveBeenCalledWith('open');
        expect(element.textContent).toContain('my-bell.mp3 is now used');
    });
    it('defaults to Silent, disables selected-sound previews, and reenables only the configured cue', () => {
        const { sounds, fixture, element } = setup();
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('.custom-sound__actions button')];
        expect(buttons).toHaveLength(14);
        expect(buttons.every(button => button.disabled)).toBe(true);
        expect([...element.querySelectorAll('.sound-picker__trigger')].every(button => button.textContent?.includes('Silent'))).toBe(true);
        fixture.componentInstance.test('open');
        expect(sounds.preview).not.toHaveBeenCalled();
        fixture.componentInstance.chooseSound('open', 'stock-market-bell');
        fixture.detectChanges();
        expect(buttons[0].disabled).toBe(false);
        expect(buttons.slice(1).every(button => button.disabled)).toBe(true);
        fixture.componentInstance.chooseSound('open', 'silent');
        fixture.detectChanges();
        expect(buttons[0].disabled).toBe(true);
    });

    it('returns to Silent when the selected upload is removed', async () => {
        const { audio, sounds, fixture } = setup();
        audio.customSounds.set({ ...emptyCustomAlertSoundMap(), open: {
            kind: 'open', name: 'mine.mp3', mimeType: 'audio/mpeg', size: 100, duration: 1, updatedAt: '2026-10-01T00:00:00Z',
        } });
        await fixture.componentInstance.reset('open');
        expect(sounds.preferences().selections?.open).toBe('silent');
        expect(fixture.componentInstance.message()).toContain('This alert is now silent');
    });

    it('offers all ten presets for each alert and changes just the chosen alert', () => {
        const { audio, sounds, fixture, element } = setup();
        const trigger = element.querySelector<HTMLButtonElement>('.sound-picker__trigger')!;
        expect(element.querySelectorAll('app-alert-sound-picker')).toHaveLength(14);
        trigger.click(); fixture.detectChanges();
        expect(element.querySelectorAll('.sound-picker__preview')).toHaveLength(11);
        const choice = [...element.querySelectorAll<HTMLButtonElement>('.sound-picker__choice')].find(button => button.textContent?.includes('Stock market bell'))!;
        choice.click();
        fixture.detectChanges();
        expect(sounds.preferences().selections).toEqual({ open: 'stock-market-bell' });
        expect(trigger.textContent).toContain('Stock market bell');
        expect(element.textContent).toContain('4.5 sec');
        expect(audio.removeCustomSound).not.toHaveBeenCalled();
        expect(sounds.preview).not.toHaveBeenCalled(); // Selection never surprises the user with playback.
    });

    it('keeps uploads selectable after switching to a preset and removing one does not reset that preset', async () => {
        const { audio, sounds, fixture, element } = setup();
        audio.customSounds.set({ ...emptyCustomAlertSoundMap(), open: {
            kind: 'open', name: 'mine.mp3', mimeType: 'audio/mpeg', size: 100, duration: 1, updatedAt: '2026-10-01T00:00:00Z',
        } });
        fixture.detectChanges();
        expect(fixture.componentInstance.selection('open')).toBe('custom');
        sounds.setSound('open', 'happy-whistle');
        fixture.detectChanges();
        element.querySelector<HTMLButtonElement>('.sound-picker__trigger')!.click(); fixture.detectChanges();
        expect(element.querySelector('.sound-picker__menu')?.textContent).toContain('mine.mp3');
        await fixture.componentInstance.reset('open');
        expect(sounds.preferences().selections?.open).toBe('happy-whistle');
    });

    it('keeps library choices available without upload storage and explains muted previews', () => {
        const { audio, sounds, fixture, element } = setup();
        audio.customSoundStorageSupported = false;
        sounds.enabled.set(false);
        fixture.detectChanges();
        expect(element.querySelectorAll('app-alert-sound-picker')).toHaveLength(14);
        expect(element.querySelector('input[type="file"]')).toBeNull();
        expect(element.querySelector<HTMLButtonElement>('.custom-sound__actions button')?.disabled).toBe(true);
        expect(element.textContent).toContain('Enable sounds');
    });

    it('shows resolved legacy presets and mute states without rewriting saved preferences', () => {
        const { sounds, fixture, element } = setup();
        sounds.preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { target: 'happy-whistle', risk: 'silent' } });
        fixture.detectChanges();
        expect(fixture.componentInstance.selection('dailyProfit')).toBe('happy-whistle');
        expect(fixture.componentInstance.selection('weeklyLoss')).toBe('silent');
        const lossPicker = element.querySelector('[aria-label="Weekly loss limit: Silent"]');
        expect(lossPicker?.querySelector('svg')).not.toBeNull();
        expect(element.querySelector<HTMLButtonElement>('[aria-label="Preview Weekly loss limit sound"]')?.disabled).toBe(true);
        expect(sounds.setSound).not.toHaveBeenCalled();
        expect(element.textContent).not.toContain('default cue configured below');
    });

    it('preserves legacy uploads as individually selectable sounds without copying or removing them', () => {
        const { audio, sounds, fixture, element } = setup();
        audio.customSounds.set({ ...emptyCustomAlertSoundMap(), risk: {
            kind: 'risk', name: 'old-warning.mp3', mimeType: 'audio/mpeg', size: 100, duration: 1, updatedAt: '2026-10-01T00:00:00Z',
        } });
        fixture.detectChanges();
        const component = fixture.componentInstance;
        expect(component.selection('dailyLoss')).toBe('inherit');
        expect(element.querySelector('[aria-label="Daily loss limit: old-warning.mp3"]')).not.toBeNull();
        expect(component.selectionDetail('dailyLoss')).toBe('1.0 sec · 1 KB');
        expect(sounds.setSound).not.toHaveBeenCalled();

        component.chooseSound('dailyLoss', 'game-over');
        fixture.detectChanges();
        expect(component.selection('dailyLoss')).toBe('game-over');
        expect(component.selection('weeklyLoss')).toBe('inherit');
        element.querySelector<HTMLButtonElement>('[aria-label="Daily loss limit: Game over"]')!.click();
        fixture.detectChanges();
        expect(element.querySelector('.sound-picker__menu')?.textContent).toContain('old-warning.mp3');
        element.querySelector<HTMLButtonElement>('[aria-label="Preview previous upload"]')!.click();
        expect(sounds.preview).toHaveBeenCalledWith('dailyLoss', 'inherit');
        component.chooseSound('dailyLoss', 'inherit');
        expect(component.selection('dailyLoss')).toBe('inherit');
        expect(audio.removeCustomSound).not.toHaveBeenCalled();
        expect(audio.installCustomSound).not.toHaveBeenCalled();
    });
});
