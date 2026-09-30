import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveCoachControlsComponent } from './live-coach-controls.component';
import { DEFAULT_LIVE_COACH_PREFERENCES, LiveCoachVoice } from './live-coach.models';
import { LiveCoachService } from './live-coach.service';

describe('Live Coach voice selector', () => {
    afterEach(() => TestBed.resetTestingModule());

    function setup(voice: LiveCoachVoice = 'cedar') {
        const preferences = signal({ ...DEFAULT_LIVE_COACH_PREFERENCES, voice });
        const aiAvailable = signal(true);
        const setVoice = vi.fn((value: LiveCoachVoice) => preferences.update(current => ({ ...current, voice: value })));
        const setVoiceEnabled = vi.fn((voiceEnabled: boolean) => preferences.update(current => ({ ...current, voiceEnabled })));
        const coach = {
            preferences, aiAvailable, setVoice, setVoiceEnabled,
            preferencesLoading: signal(false), supported: signal(true), previewing: signal(false),
            narratorState: signal('idle'), liveState: signal('idle'), liveStatus: () => 'Disconnected',
            liveDetail: () => '', audioReady: signal(false), aiStatusLabel: () => 'Off',
            lastSpokenText: signal(null), paused: signal(false), recentComments: signal([]),
            voiceWarning: signal(null), voiceFallback: signal(false), error: signal(null),
            syncWarning: signal(false), storageWarning: signal(false),
            sounds: { enabled: signal(true) },
        };
        TestBed.configureTestingModule({ providers: [{ provide: LiveCoachService, useValue: coach }] });
        const fixture = TestBed.createComponent(LiveCoachControlsComponent);
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('app-live-coach-voice-select select') as HTMLSelectElement;
        return { fixture, select, preferences, aiAvailable, setVoice, coach };
    }

    it.each<LiveCoachVoice>(['cedar', 'browser', 'marin', 'coral', 'verse'])('renders the saved %s selection on first load', voice => {
        const { select } = setup(voice);
        expect(select.options.length).toBe(14);
        expect(select.options[0].textContent).toBe('Cedar · Default');
        expect(select.value).toBe(voice);
    });

    it('reflects synced preferences and forwards a newly selected voice', () => {
        const { fixture, select, preferences, setVoice } = setup();
        preferences.update(current => ({ ...current, voice: 'nova' }));
        fixture.detectChanges();
        expect(select.value).toBe('nova');
        select.value = 'onyx';
        select.dispatchEvent(new Event('change'));
        expect(setVoice).toHaveBeenCalledWith('onyx');
    });

    it('keeps browser voice available when AI access is unavailable', () => {
        const { fixture, select, aiAvailable } = setup('browser');
        aiAvailable.set(false); fixture.detectChanges();
        expect(select.querySelector('optgroup')!.disabled).toBe(true);
        expect(select.querySelector<HTMLOptionElement>('option[value="browser"]')!.disabled).toBe(false);
    });

    it('uses one shared voice playback control and reflects synced settings without changing automatic coaching', () => {
        const { fixture, preferences, coach } = setup();
        const root = fixture.nativeElement as HTMLElement;
        const controls = root.querySelectorAll<HTMLInputElement>('input[aria-label="Voice playback"]');
        expect(controls).toHaveLength(1);
        const voice = controls[0], automatic = preferences().enabled;
        voice.click(); fixture.detectChanges();
        expect(coach.setVoiceEnabled).toHaveBeenCalledWith(false);
        expect(preferences().enabled).toBe(automatic); expect(coach.sounds.enabled()).toBe(true);
        preferences.update(p => ({ ...p, voiceEnabled: true })); fixture.detectChanges();
        expect(voice.checked).toBe(true);
        coach.preferencesLoading.set(true); fixture.detectChanges(); expect(voice.disabled).toBe(true);
        coach.sounds.enabled.set(false); fixture.detectChanges();
        expect(root.querySelectorAll('.coach-voice__hint')).toHaveLength(1);
        expect(root.textContent).toContain('Master sound is off.'); expect(voice.checked).toBe(true);
    });
});
