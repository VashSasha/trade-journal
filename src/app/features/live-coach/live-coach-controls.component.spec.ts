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
        const coach = {
            preferences, aiAvailable, setVoice,
            preferencesLoading: signal(false), supported: signal(true), previewing: signal(false),
            narratorState: signal('idle'), liveState: signal('idle'), liveStatus: () => 'Disconnected',
            liveDetail: () => '', audioReady: signal(false), aiStatusLabel: () => 'Off',
            lastSpokenText: signal(null), paused: signal(false), recentComments: signal([]),
            voiceWarning: signal(null), voiceFallback: signal(false), error: signal(null),
            syncWarning: signal(false), storageWarning: signal(false),
        };
        TestBed.configureTestingModule({ providers: [{ provide: LiveCoachService, useValue: coach }] });
        const fixture = TestBed.createComponent(LiveCoachControlsComponent);
        fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('#coach-voice') as HTMLSelectElement;
        return { fixture, select, preferences, aiAvailable, setVoice };
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
});
