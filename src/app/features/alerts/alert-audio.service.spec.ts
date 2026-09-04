import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertAudioService } from './alert-audio.service';

const gain = () => ({
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
});
const oscillator = () => ({
    type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(),
    start: vi.fn((_at: number) => {}), stop: vi.fn((_at: number) => {}), onended: null as (() => void) | null,
});
class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    gains: ReturnType<typeof gain>[] = [];
    oscillators: ReturnType<typeof oscillator>[] = [];
    constructor() { FakeAudioContext.instances.push(this); }
    createGain() { const node = gain(); this.gains.push(node); return node; }
    createOscillator() { const node = oscillator(); this.oscillators.push(node); return node; }
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
}

describe('local alert audio', () => {
    beforeEach(() => {
        vi.useFakeTimers(); FakeAudioContext.instances = [];
        vi.stubGlobal('AudioContext', FakeAudioContext);
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
});
