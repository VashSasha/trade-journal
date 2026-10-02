import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';
import { emptyCustomAlertSoundMap } from './custom-alert-sounds.models';
import { CustomAlertSoundsService } from './custom-alert-sounds.service';
import { SessionSoundPreferencesService } from './session-sound-preferences.service';
import { DEFAULT_SESSION_SOUNDS, SessionSoundPreferences } from './session-alerts.utils';

const gain = () => ({
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
});
const oscillator = () => ({
    type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(),
    start: vi.fn((_at: number) => {}), stop: vi.fn((_at: number) => {}), onended: null as (() => void) | null,
});
const bufferSource = () => ({
    buffer: null as AudioBuffer | null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), onended: null as (() => void) | null,
});
class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    gains: ReturnType<typeof gain>[] = [];
    oscillators: ReturnType<typeof oscillator>[] = [];
    sources: ReturnType<typeof bufferSource>[] = [];
    constructor() { FakeAudioContext.instances.push(this); }
    createGain() { const node = gain(); this.gains.push(node); return node; }
    createOscillator() { const node = oscillator(); this.oscillators.push(node); return node; }
    createBufferSource() { const node = bufferSource(); this.sources.push(node); return node; }
    decodeAudioData = vi.fn(async () => ({ duration: 1.25 }) as AudioBuffer);
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
}

describe('local alert audio', () => {
    const preferences = signal<SessionSoundPreferences>({ ...DEFAULT_SESSION_SOUNDS });
    let library: {
        sounds: ReturnType<typeof signal>; loading: ReturnType<typeof signal>; error: ReturnType<typeof signal>;
        revision: ReturnType<typeof signal>; supported: boolean; currentRecords: ReturnType<typeof vi.fn>;
        save: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>;
    };
    beforeEach(() => {
        preferences.set({ ...DEFAULT_SESSION_SOUNDS });
        vi.useFakeTimers(); FakeAudioContext.instances = [];
        vi.stubGlobal('AudioContext', FakeAudioContext);
        library = {
            sounds: signal(emptyCustomAlertSoundMap()), loading: signal(false), error: signal(null),
            revision: signal(0), supported: true, currentRecords: vi.fn(async () => []),
            save: vi.fn(async () => {}), remove: vi.fn(async () => {}),
        };
        TestBed.configureTestingModule({ providers: [
            { provide: CustomAlertSoundsService, useValue: library },
            { provide: SessionSoundPreferencesService, useValue: { preferences } },
        ] });
    });
    afterEach(() => {
        TestBed.inject(AlertAudioService).stop(); TestBed.resetTestingModule();
        vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
    });
    it('does not create audio until explicitly activated, and resumes from that call', async () => {
        const audio = TestBed.inject(AlertAudioService);
        expect(FakeAudioContext.instances).toHaveLength(0);
        const activation = audio.activate();
        expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
        await activation; expect(audio.running()).toBe(true);
    });
    it('plays a metallic triple opening bell and a descending double closing bell', async () => {
        const audio = TestBed.inject(AlertAudioService); await audio.activate();
        const context = FakeAudioContext.instances[0];
        expect(audio.play('open', 1000)).toBe(1850);
        expect(context.oscillators).toHaveLength(15); // 3 strikes × 5 metallic partials.
        expect(context.oscillators.filter((_, index) => index % 5 === 0).map(o => o.frequency.value))
            .toEqual([784, 831, 784]);
        expect(context.gains[0].gain.value).toBe(0.3);
        expect(context.gains[1].gain.exponentialRampToValueAtTime).toHaveBeenCalledTimes(2);
        expect(context.oscillators[0].stop.mock.calls[0][0]).toBeCloseTo(1.19);
        context.oscillators[0].onended!();
        expect(context.oscillators[0].disconnect).toHaveBeenCalled();
        expect(context.gains[1].disconnect).toHaveBeenCalled();
        expect(audio.play('close', 30)).toBe(0); // No sound pile-up.
        context.currentTime = 2; expect(audio.play('close', 30)).toBe(2070);
        expect(context.oscillators.slice(15).filter((_, index) => index % 5 === 0).map(o => o.frequency.value))
            .toEqual([659.25, 523.25]);
    });
    it('never resumes a suspended context from automatic playback', async () => {
        const audio = TestBed.inject(AlertAudioService); await audio.activate();
        const context = FakeAudioContext.instances[0]; context.state = 'suspended';
        expect(() => audio.play('open', 30)).toThrow('paused');
        expect(context.resume).toHaveBeenCalledOnce();
    });
    it('provides distinct semantic cues for targets and risk guardrails', async () => {
        const audio = TestBed.inject(AlertAudioService); await audio.activate();
        const context = FakeAudioContext.instances[0];
        expect(audio.play('target', 45)).toBe(1690);
        expect(context.oscillators.filter((_, index) => index % 5 === 0).map(o => o.frequency.value))
            .toEqual([659.25, 783.99, 987.77]);
        context.currentTime = 2;
        expect(audio.play('risk', 45)).toBe(2030);
        expect(context.oscillators.slice(15).filter((_, index) => index % 5 === 0).map(o => o.frequency.value))
            .toEqual([587.33, 440, 349.23]);
    });
    it('closes audio on mute and cannot keep scheduling sounds', async () => {
        const audio = TestBed.inject(AlertAudioService); await audio.activate(); audio.play('open', 30); audio.stop();
        expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
        expect(audio.running()).toBe(false);
        expect(() => audio.play('open', 30)).toThrow('paused');
    });
    it('bounds a browser-blocked resume instead of waiting forever', async () => {
        class BlockedContext extends FakeAudioContext { override resume = vi.fn(() => new Promise<void>(() => {})); }
        vi.stubGlobal('AudioContext', BlockedContext);
        const activation = TestBed.inject(AlertAudioService).activate();
        const rejected = expect(activation).rejects.toThrow('blocked');
        await vi.advanceTimersByTimeAsync(3000); await rejected;
    });
    it('reports an unsupported browser without creating a context', async () => {
        vi.stubGlobal('AudioContext', undefined);
        const audio = TestBed.inject(AlertAudioService);
        expect(audio.supported()).toBe(false);
        await expect(audio.activate()).rejects.toThrow('not supported');
    });
    it('validates, saves, and plays a custom semantic cue before the built-in fallback', async () => {
        const audio = TestBed.inject(AlertAudioService);
        const file = {
            name: 'opening-bell.mp3', size: 800, type: 'audio/mpeg',
            arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
        } as unknown as File;

        await audio.installCustomSound('open', file);
        expect(library.save).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'open', name: 'opening-bell.mp3', duration: 1.25,
        }));
        expect(audio.play('open', 45)).toBe(1330);
        expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
        expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
    });
    it('closes a newly unlocked audio context when a custom file cannot be decoded', async () => {
        const audio = TestBed.inject(AlertAudioService);
        const file = {
            name: 'broken.mp3', size: 800, type: 'audio/mpeg',
            arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
        } as unknown as File;
        const contextPromise = audio.installCustomSound('open', file);
        const context = FakeAudioContext.instances[0];
        context.decodeAudioData.mockRejectedValueOnce(new DOMException('Invalid audio'));

        await expect(contextPromise).rejects.toThrow('could not be decoded');
        expect(context.close).toHaveBeenCalledOnce();
        expect(audio.running()).toBe(false);
    });

    it('only downloads selected presets after activation, deduplicates them, and reuses decoded audio', async () => {
        const fetchSound = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } }));
        vi.stubGlobal('fetch', fetchSound);
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { open: 'hell-yeah', target: 'hell-yeah' } });
        const audio = TestBed.inject(AlertAudioService);
        TestBed.tick();
        expect(fetchSound).not.toHaveBeenCalled();
        await audio.activate();
        expect(fetchSound).toHaveBeenCalledOnce();
        expect(String(fetchSound.mock.calls[0][0])).toContain('/sounds/library-v1/hell-yeah.mp3');
        expect(audio.play('open', 45)).toBe(1330);
        expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
        await audio.activate();
        expect(fetchSound).toHaveBeenCalledOnce();
    });

    it('falls back to the default bell on missing/HTML assets and retries on preview activation', async () => {
        const fetchSound = vi.fn(async () => new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }));
        vi.stubGlobal('fetch', fetchSound);
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { open: 'stock-market-bell' } });
        const audio = TestBed.inject(AlertAudioService);
        await audio.activate();
        expect(audio.presetSoundsError()).toContain('default bell');
        expect(audio.play('open', 45)).toBe(1850);
        fetchSound.mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }));
        await audio.activate();
        expect(audio.presetSoundsError()).toBeNull();
        FakeAudioContext.instances[0].currentTime = 3;
        expect(audio.play('open', 45)).toBe(1330);
    });

    it('can switch from an upload to default and back without removing the upload', async () => {
        const audio = TestBed.inject(AlertAudioService);
        await audio.installCustomSound('open', {
            name: 'bell.mp3', size: 2, type: 'audio/mpeg', arrayBuffer: async () => new ArrayBuffer(2),
        } as File);
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { open: 'default' } });
        expect(audio.play('open', 45)).toBe(1850);
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { open: 'custom' } });
        FakeAudioContext.instances[0].currentTime = 3;
        expect(audio.play('open', 45)).toBe(1330);
        expect(library.remove).not.toHaveBeenCalled();
    });

    it('aborts in-flight preset loading on mute without reviving audio', async () => {
        vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })));
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { open: 'game-over' } });
        const audio = TestBed.inject(AlertAudioService);
        const loading = audio.activate();
        await vi.advanceTimersByTimeAsync(1);
        audio.stop();
        await loading;
        expect(audio.running()).toBe(false);
        expect(audio.presetSoundsLoading()).toBe(false);
        expect(audio.presetSoundsError()).toBeNull();
    });

    it('inherits legacy warning presets for specific rules and allows a silent override', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })));
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { risk: 'oh-no', weeklyLoss: 'silent' } });
        const audio = TestBed.inject(AlertAudioService); await audio.activate();
        expect(audio.play('dailyLoss', 45)).toBe(1330);
        FakeAudioContext.instances[0].currentTime = 3;
        expect(audio.play('weeklyLoss', 45)).toBe(0);
        expect(audio.play('positionOpened', 45)).toBe(0);
    });

    it('keeps legacy uploaded warnings playable for each trigger after the shared controls are hidden', async () => {
        const audio = TestBed.inject(AlertAudioService);
        const file = {
            name: 'old-warning.mp3', size: 800, type: 'audio/mpeg',
            arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
        } as unknown as File;
        await audio.installCustomSound('risk', file);
        const context = FakeAudioContext.instances[0];
        expect(audio.play('dailyLoss', 45)).toBe(1330);
        expect(context.sources).toHaveLength(1);
        expect(context.oscillators).toHaveLength(0);
        preferences.set({ ...DEFAULT_SESSION_SOUNDS, selections: { dailyLoss: 'default' } });
        context.currentTime = 3;
        expect(audio.play('dailyLoss', 45)).toBe(2030);
        context.currentTime = 6;
        expect(audio.play('weeklyLoss', 45)).toBe(1330);
        expect(library.remove).not.toHaveBeenCalled();
    });

    it('auditions a different clip without changing the selected alert sound', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })));
        const audio = TestBed.inject(AlertAudioService); await audio.activate();
        await audio.prepareSound('hell-yeah');
        expect(audio.play('open', 45, 'hell-yeah')).toBe(1330);
        expect(preferences().selections).toBeUndefined();
        FakeAudioContext.instances[0].currentTime = 3;
        expect(audio.play('open', 45)).toBe(1850);
    });
});
