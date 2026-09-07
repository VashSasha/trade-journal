import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';
import { CustomAlertSoundControlsComponent } from './custom-alert-sound-controls.component';
import { emptyCustomAlertSoundMap } from './custom-alert-sounds.models';
import { SessionAlertsService } from './session-alerts.service';

describe('custom alert sound controls', () => {
    function setup() {
        const audio = {
            customSounds: signal(emptyCustomAlertSoundMap()), customSoundsLoading: signal(false),
            customSoundsError: signal<string | null>(null), customSoundStorageSupported: true,
            installCustomSound: vi.fn(async (kind: string, file: File) => ({
                kind, name: file.name, mimeType: file.type, size: file.size,
                duration: 1.2, updatedAt: '2026-09-06T00:00:00.000Z',
            })),
            removeCustomSound: vi.fn(async () => {}),
        };
        const sounds = {
            previewing: signal(false), state: signal('off'), preferences: signal({ volume: 45 }), preview: vi.fn(async () => {}),
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
        expect(element.querySelectorAll('.custom-sound')).toHaveLength(4);
        expect(element.textContent).toContain('Session opening');
        expect(element.textContent).toContain('Target reached');
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
});
