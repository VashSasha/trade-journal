import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';
import { SessionAlertsService } from './session-alerts.service';

const KEY = 'nvzn_session_sound_preferences_v1';

describe('session sound coordinator', () => {
    const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks');
    let held: boolean;
    let audio: { supported: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>;
        running: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; setVolume: ReturnType<typeof vi.fn> };
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-06T11:59:50Z'));
        localStorage.clear();
        held = false;
        Object.defineProperty(window.navigator, 'locks', { configurable: true, value: {
            request: vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
                if (held) { await callback(null); return; }
                held = true;
                try { await callback({ name: 'session-owner' }); } finally { held = false; }
            }),
        } });
        audio = { supported: vi.fn(() => true), activate: vi.fn(async () => {}), play: vi.fn(() => 1850),
            running: vi.fn(() => true), stop: vi.fn(), setVolume: vi.fn() };
        TestBed.configureTestingModule({ providers: [{ provide: AlertAudioService, useValue: audio }] });
    });
    afterEach(() => {
        TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks();
        if (originalLocks) Object.defineProperty(window.navigator, 'locks', originalLocks);
        else Reflect.deleteProperty(window.navigator, 'locks');
    });
    const service = () => TestBed.inject(SessionAlertsService);

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
    it('honors individual alert types', async () => {
        const sounds = service(); sounds.setKind('open', false);
        await sounds.enable(); vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
        vi.setSystemTime(new Date('2026-07-06T15:59:50Z'));
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('close', 45);
    });
    it('skips missed events after wake, even when the event was recent', async () => {
        const sounds = service(); await sounds.enable();
        vi.setSystemTime(new Date('2026-07-06T12:00:05Z'));
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('skips a large timer gap without a visibility event', async () => {
        await service().enable();
        vi.setSystemTime(new Date('2026-07-06T16:00:05Z'));
        vi.advanceTimersByTime(10_000);
        expect(audio.play).not.toHaveBeenCalled();
    });
    it('does not repeat a handled event after the clock moves back', async () => {
        await service().enable(); vi.advanceTimersByTime(10_000);
        vi.setSystemTime(new Date('2026-07-06T11:59:40Z'));
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
    it('tests a sound without enabling recurring alerts; repeat clicks are ignored', async () => {
        const sounds = service(); const first = sounds.preview('close'); await sounds.preview('close'); await first;
        expect(sounds.enabled()).toBe(false);
        expect(audio.play).toHaveBeenCalledExactlyOnceWith('close', 45);
        vi.advanceTimersByTime(1949); expect(sounds.previewing()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(sounds.previewing()).toBe(false); expect(audio.stop).toHaveBeenCalled();
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
        await Promise.resolve(); sounds.mute();
        await deliver(); await pending;
        expect(sounds.enabled()).toBe(false);
        vi.advanceTimersByTime(30_000); expect(audio.play).not.toHaveBeenCalled();
    });
    it('applies other-tab preference updates without automatically enabling sounds', () => {
        const sounds = service();
        localStorage.setItem(KEY, '{"volume":65,"opens":false}');
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
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
