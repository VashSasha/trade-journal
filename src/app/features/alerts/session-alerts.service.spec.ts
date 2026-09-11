import { DestroyRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';
import { SessionAlertsService } from './session-alerts.service';
import { SessionAlertControlsComponent } from './session-alert-controls.component';
import { SessionsWidgetComponent } from '../sessions/sessions-widget.component';
import { provideRouter } from '@angular/router';
import { MasterSoundToggleComponent } from './master-sound-toggle.component';
import { SessionSoundPreferencesService } from './session-sound-preferences.service';
import { normalizeSoundPreferences, parseSoundPreferences, SessionSoundPreferences } from './session-alerts.utils';
import { SessionScheduleService } from '../sessions/session-schedule.service';
import { REFERENCE_SESSIONS, SessionDefinition } from '../sessions/sessions.model';

const KEY = 'nvzn_session_sound_preferences_v1';

describe('session sound coordinator', () => {
    const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks');
    let held: boolean;
    const definitions = signal<readonly SessionDefinition[]>(REFERENCE_SESSIONS);
    let audio: { supported: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>;
        running: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; setVolume: ReturnType<typeof vi.fn> };
    let preferenceStore: {
        owner: ReturnType<typeof signal<string | null>>;
        preferences: ReturnType<typeof signal<SessionSoundPreferences>>;
        loading: ReturnType<typeof signal<boolean>>;
        storageWarning: ReturnType<typeof signal<boolean>>;
        syncWarning: ReturnType<typeof signal<boolean>>;
        update: (updater: (value: SessionSoundPreferences) => SessionSoundPreferences, immediate?: boolean) => void;
    };
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-06T13:29:50Z'));
        localStorage.clear();
        held = false;
        definitions.set(REFERENCE_SESSIONS);
        Object.defineProperty(window.navigator, 'locks', { configurable: true, value: {
            request: vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
                if (held) { await callback(null); return; }
                held = true;
                try { await callback({ name: 'session-owner' }); } finally { held = false; }
            }),
        } });
        audio = { supported: vi.fn(() => true), activate: vi.fn(async () => {}), play: vi.fn(() => 1850),
            running: vi.fn(() => true), stop: vi.fn(), setVolume: vi.fn() };
        TestBed.configureTestingModule({ providers: [
            provideRouter([]),
            { provide: AlertAudioService, useValue: audio },
            { provide: SessionScheduleService, useValue: { definitions, loading: signal(false) } },
            { provide: SessionSoundPreferencesService, useFactory: () => {
                let raw: string | null = null;
                let blocked = false;
                try { raw = localStorage.getItem(KEY); } catch { blocked = true; }
                const preferences = signal(parseSoundPreferences(raw));
                preferenceStore = {
                    owner: signal('test-owner'), preferences, loading: signal(false),
                    storageWarning: signal(blocked), syncWarning: signal(false),
                    update: updater => {
                        const next = normalizeSoundPreferences(updater(preferences()))!;
                        preferences.set(next);
                        try { localStorage.setItem(KEY, JSON.stringify(next)); }
                        catch { preferenceStore.storageWarning.set(true); }
                    },
                };
                return preferenceStore;
            } },
        ] });
    });
    afterEach(() => {
        TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks();
        if (originalLocks) Object.defineProperty(window.navigator, 'locks', originalLocks);
        else Reflect.deleteProperty(window.navigator, 'locks');
    });
    const service = () => TestBed.inject(SessionAlertsService);

    it('syncs the real header master toggle with Settings without changing bell selections', async () => {
        const header = TestBed.createComponent(MasterSoundToggleComponent);
        const settings = TestBed.createComponent(SessionAlertControlsComponent);
        const sounds = service();
        sounds.setKind('close', false);
        header.detectChanges(); settings.detectChanges();
        expect(header.componentInstance.sounds).toBe(settings.componentInstance.sounds);
        const button = header.nativeElement.querySelector('button') as HTMLButtonElement;
        expect(button.getAttribute('aria-label')).toBe('Enable all sounds');
        button.click();
        for (let i = 0; i < 12; i++) await Promise.resolve();
        header.detectChanges(); settings.detectChanges();
        expect(sounds.enabled()).toBe(true);
        const mute = [...settings.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
            .find(b => b.textContent === 'Mute all sounds')!;
        mute.click(); header.detectChanges(); settings.detectChanges();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(sounds.preferences()).toMatchObject({ armed: false, opens: true, closes: false });
    });

    it('activates registered voice engines within the same gesture and stops them on master mute', async () => {
        const voice = { activate: vi.fn(async () => true), stop: vi.fn() };
        const sounds = service();
        sounds.registerPlayback(voice, TestBed.inject(DestroyRef));
        const pending = sounds.toggle();
        expect(voice.activate).toHaveBeenCalledOnce();
        await pending;
        sounds.mute();
        expect(voice.stop).toHaveBeenCalledOnce();
        expect(sounds.enabled()).toBe(false);
        await sounds.preview('open');
        expect(audio.play).not.toHaveBeenCalled();
    });

    it('uses one coordinator and matching status in the header and Settings', async () => {
        localStorage.setItem(KEY, '{"volume":45,"opens":true,"closes":true,"armed":true}');
        const header = TestBed.createComponent(SessionsWidgetComponent);
        const settings = TestBed.createComponent(SessionAlertControlsComponent);
        header.detectChanges(); settings.detectChanges();
        const sounds = service();
        expect(header.componentInstance.sounds).toBe(settings.componentInstance.sounds);
        const assertStatus = (label: string) => {
            header.detectChanges(); settings.detectChanges();
            expect(header.nativeElement.querySelector('.sessions__caption').textContent.toLowerCase()).toContain('sounds ' + label.toLowerCase());
            expect(settings.nativeElement.querySelector('summary').textContent).toContain(label);
        };
        assertStatus('Ready');
        preferenceStore.loading.set(true); assertStatus('Syncing');
        preferenceStore.loading.set(false);
        const enabling = sounds.enable(); assertStatus('Enabling');
        await enabling; assertStatus('On');
        sounds.mute(); assertStatus('Off');
        audio.activate.mockRejectedValue(new Error('Audio was blocked.'));
        await sounds.enable(); assertStatus('Needs attention');
    });

    it('does not auto-reactivate ahead of an explicit Settings button click', async () => {
        localStorage.setItem(KEY, '{"volume":45,"opens":true,"closes":true,"armed":true}');
        const fixture = TestBed.createComponent(SessionAlertControlsComponent);
        fixture.detectChanges();
        const button = [...fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
            .find(b => b.textContent?.includes('Enable all sounds'))!;
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        fixture.detectChanges();
        expect(service().state()).toBe('off');
        expect(audio.activate).not.toHaveBeenCalled();
        button.click();
        for (let turn = 0; turn < 6; turn++) await Promise.resolve();
        fixture.detectChanges();
        expect(service().enabled()).toBe(true);
        expect(audio.activate).toHaveBeenCalledOnce();
    });

    it('starts silent even if storage includes a forged enabled flag', () => {
        localStorage.setItem(KEY, '{"enabled":true,"volume":50}');
        const sounds = service();
        expect(sounds.enabled()).toBe(false);
        expect(audio.activate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(30_000);
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('plays once at a boundary, without playing anything on enable', async () => {
        const sounds = service();
        await sounds.enable();
        expect(sounds.enabled()).toBe(true);
        expect(sounds.preferences().armed).toBe(true);
        expect(JSON.parse(localStorage.getItem(KEY)!).armed).toBe(true);
        expect(audio.play).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('open', 45);
        expect(sounds.lastAlert()).toBe('New York reference window started.');
        vi.advanceTimersByTime(30_000);
        expect(audio.play).toHaveBeenCalledOnce();
    });
    it('does not cancel explicit activation while preference effects run', async () => {
        let finish!: () => void;
        audio.activate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
        const sounds = service();
        TestBed.tick();
        const pending = sounds.enable();
        TestBed.tick();
        expect(sounds.state()).toBe('enabling');
        finish(); await pending; TestBed.tick();
        expect(sounds.enabled()).toBe(true);
        vi.advanceTimersByTime(10_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('open', 45);
    });
    it('keeps the opening bell active after Settings controls are destroyed', async () => {
        const fixture = TestBed.createComponent(SessionAlertControlsComponent);
        fixture.detectChanges();
        const sounds = service();
        await sounds.enable(); fixture.detectChanges();
        fixture.destroy();
        expect(sounds.enabled()).toBe(true);
        vi.advanceTimersByTime(10_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('open', 45);
    });
    it('still stops when a synced preference disarms sounds or the user changes', async () => {
        const sounds = service(); TestBed.tick(); await sounds.enable(); TestBed.tick();
        preferenceStore.preferences.update(p => ({ ...p, armed: false })); TestBed.tick();
        expect(sounds.enabled()).toBe(false);
        await Promise.resolve(); await Promise.resolve();
        await sounds.enable(); TestBed.tick();
        preferenceStore.owner.set('another-user'); TestBed.tick();
        expect(sounds.enabled()).toBe(false);
        expect(audio.stop).toHaveBeenCalled();
    });
    it('honors individual alert types', async () => {
        const sounds = service(); sounds.setKind('open', false);
        await sounds.enable(); vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
        vi.setSystemTime(new Date('2026-07-06T15:59:50Z'));
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('close', 45);
    });

    it('does not ring for a disabled session', async () => {
        definitions.set(REFERENCE_SESSIONS.filter(s => s.id !== 'new-york'));
        await service().enable(); vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
    });

    it('rebases schedule edits instead of replaying a crossed bell', async () => {
        await service().enable();
        definitions.set(REFERENCE_SESSIONS.map(s => s.id === 'new-york' ? { ...s, openMinute: 570 + 1 } : s));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('open', 45);
    });
    it('plays a recent opening after a background timer was throttled', async () => {
        const sounds = service(); await sounds.enable();
        vi.setSystemTime(new Date('2026-07-06T13:32:00Z'));
        document.dispatchEvent(new Event('visibilitychange'));
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('open', 45);
        expect(sounds.lastAlert()).toBe('New York reference window started.');
        window.dispatchEvent(new Event('focus'));
        expect(audio.play).toHaveBeenCalledOnce();
    });
    it('skips a large timer gap without a visibility event', async () => {
        await service().enable();
        vi.setSystemTime(new Date('2026-07-06T16:00:05Z'));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('does not repeat a handled event after the clock moves back', async () => {
        await service().enable(); vi.advanceTimersByTime(10_000);
        vi.setSystemTime(new Date('2026-07-06T13:29:40Z'));
        vi.advanceTimersByTime(40_000);
        expect(audio.play).toHaveBeenCalledOnce();
    });
    it('mutes immediately, stops timers and releases ownership', async () => {
        const sounds = service(); await sounds.enable(); sounds.mute();
        await Promise.resolve(); await Promise.resolve();
        expect(sounds.enabled()).toBe(false); expect(held).toBe(false);
        expect(sounds.preferences().armed).toBe(false);
        expect(JSON.parse(localStorage.getItem(KEY)!).armed).toBe(false);
        expect(audio.stop).toHaveBeenCalled();
        vi.advanceTimersByTime(30_000);
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('cannot enable while a different tab owns automatic sounds', async () => {
        held = true;
        const sounds = service(); await sounds.enable();
        expect(sounds.enabled()).toBe(false);
        expect(sounds.error()).toContain('another NVZN tab');
        expect(audio.stop).toHaveBeenCalled();
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('guards repeated enable clicks and cancellation while audio unlock is pending', async () => {
        let finish!: () => void;
        audio.activate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
        const sounds = service(); const first = sounds.enable(); await sounds.enable();
        expect(audio.activate).toHaveBeenCalledOnce();
        sounds.mute(); finish(); await first;
        expect(sounds.state()).toBe('off'); expect(held).toBe(false);
        vi.advanceTimersByTime(30_000); expect(audio.play).not.toHaveBeenCalled();
    });
    it('surfaces blocked audio without leaving a pending spinner', async () => {
        audio.activate.mockRejectedValue(new Error('Audio was blocked.'));
        const sounds = service(); await sounds.enable();
        expect(sounds.state()).toBe('off'); expect(sounds.error()).toContain('blocked');
    });
    it('stops if the browser pauses audio and never resumes it from the timer', async () => {
        const sounds = service(); await sounds.enable(); audio.running.mockReturnValue(false);
        vi.advanceTimersByTime(10_000);
        expect(sounds.enabled()).toBe(false);
        expect(sounds.error()).toContain('paused audio');
        expect(audio.activate).toHaveBeenCalledOnce();
    });
    it('tests a sound only after master enable; repeat clicks are ignored', async () => {
        const sounds = service();
        await sounds.preview('close'); expect(audio.play).not.toHaveBeenCalled();
        await sounds.enable(); sounds.setKind('open', false);
        const first = sounds.preview('close'); await sounds.preview('close'); await first;
        expect(sounds.enabled()).toBe(true);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('close', 45);
        vi.advanceTimersByTime(1949); expect(sounds.previewing()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(sounds.previewing()).toBe(false);
        vi.advanceTimersByTime(30_000); expect(audio.play).toHaveBeenCalledOnce();
    });
    it('persists validated preferences and opt-in intent, clamps input, and mutes at zero', async () => {
        const sounds = service(); await sounds.enable(); sounds.setVolume(1000);
        sounds.setKind('close', false);
        expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ volume: 100, opens: true, closes: false, armed: true });
        sounds.setVolume(NaN); expect(sounds.preferences().volume).toBe(100);
        sounds.setVolume(0); expect(sounds.enabled()).toBe(false);
    });
    it('survives unavailable browser storage', () => {
        const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
        Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
        try {
            const sounds = service(); sounds.setVolume(45);
            expect(sounds.preferences().volume).toBe(45); expect(sounds.storageWarning()).toBe(true);
        } finally { Object.defineProperty(window, 'localStorage', original); }
    });
    it('stops after the last control is destroyed, not just any duplicate widget', async () => {
        const callbacks: (() => void)[] = [];
        const host = { onDestroy: (cb: () => void) => { callbacks.push(cb); } } as unknown as DestroyRef;
        const sounds = service(); sounds.attach(host); sounds.attach(host); await sounds.enable();
        callbacks[0](); expect(sounds.enabled()).toBe(true);
        callbacks[1](); expect(sounds.enabled()).toBe(false);
    });
    it('stops when the page exits (including back/forward cache)', async () => {
        const sounds = service(); await sounds.enable(); window.dispatchEvent(new Event('pagehide'));
        expect(sounds.enabled()).toBe(false);
    });
    it('keeps the master sound active when only performance alerts need it', async () => {
        const sounds = service(); sounds.setKind('open', false); sounds.setKind('close', false);
        await sounds.enable(); expect(sounds.enabled()).toBe(true);
        expect(audio.activate).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(30_000); expect(audio.play).not.toHaveBeenCalled();
    });
    it('does not acquire a lease that arrives after cancel', async () => {
        let deliver!: () => Promise<void>;
        const request = vi.fn((_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) =>
            new Promise<unknown>(resolve => {
                deliver = async () => resolve(await callback({ name: 'session-owner', mode: 'exclusive' } as Lock));
            }));
        Object.defineProperty(window.navigator, 'locks', {
            configurable: true, value: { request } as unknown as LockManager,
        });
        const sounds = service(); const pending = sounds.enable();
        for (let i = 0; i < 6; i++) await Promise.resolve();
        sounds.mute();
        await deliver(); await pending;
        expect(sounds.enabled()).toBe(false);
        vi.advanceTimersByTime(30_000); expect(audio.play).not.toHaveBeenCalled();
    });
    it('applies other-tab preference updates without automatically enabling sounds', () => {
        const sounds = service();
        preferenceStore.preferences.set(parseSoundPreferences('{"volume":65,"opens":false}'));
        TestBed.tick();
        expect(sounds.preferences()).toEqual({ volume: 65, opens: false, closes: true, armed: false });
        expect(sounds.enabled()).toBe(false);
        expect(audio.activate).not.toHaveBeenCalled();
    });
    it('remembers opt-in after reload but waits for the first user gesture', async () => {
        localStorage.setItem(KEY, '{"volume":45,"opens":true,"closes":true,"armed":true}');
        const sounds = service();
        expect(sounds.waitingForGesture()).toBe(true);
        expect(audio.activate).not.toHaveBeenCalled();
        expect(audio.play).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('pointerdown'));
        for (let turn = 0; turn < 6; turn++) await Promise.resolve();
        expect(sounds.enabled()).toBe(true);
        expect(sounds.waitingForGesture()).toBe(false);
        expect(audio.activate).toHaveBeenCalledOnce();
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('can reactivate from a keyboard gesture and removes both gesture listeners', async () => {
        localStorage.setItem(KEY, '{"volume":45,"opens":true,"closes":true,"armed":true}');
        const remove = vi.spyOn(document, 'removeEventListener');
        const sounds = service(); document.dispatchEvent(new Event('keydown'));
        for (let turn = 0; turn < 6; turn++) await Promise.resolve();
        expect(sounds.enabled()).toBe(true);
        expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        document.dispatchEvent(new Event('pointerdown'));
        expect(audio.activate).toHaveBeenCalledOnce();
    });
});
