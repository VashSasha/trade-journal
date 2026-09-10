import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCoachNarratorService } from './live-coach-narrator.service';

class FakeUtterance {
    rate = 1;
    pitch = 1;
    volume = 1;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(readonly text: string) {}
}

describe('LiveCoachNarratorService', () => {
    const cancel = vi.fn();
    const speak = vi.fn((utterance: FakeUtterance) => queueMicrotask(() => utterance.onend?.()));

    beforeEach(() => {
        vi.useFakeTimers();
        cancel.mockReset();
        speak.mockReset();
        speak.mockImplementation((utterance: FakeUtterance) => { queueMicrotask(() => utterance.onend?.()); });
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
        Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: { cancel, speak },
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        Reflect.deleteProperty(window, 'speechSynthesis');
    });

    it('speaks through the isolated browser narrator and clamps unsafe rates', async () => {
        const service = TestBed.inject(LiveCoachNarratorService);

        await expect(service.speak('Position increased.', 3)).resolves.toBe(true);

        const utterance = speak.mock.calls[0][0];
        expect(utterance.text).toBe('Position increased.');
        expect(utterance.rate).toBe(1.2);
        expect(service.state()).toBe('idle');
    });

    it('settles cancelled playback and prevents its deadline from stopping the next comment', async () => {
        speak.mockImplementation(() => {});
        const service = TestBed.inject(LiveCoachNarratorService);
        const first = service.speak('First comment.');
        await vi.advanceTimersByTimeAsync(20_000);
        const second = service.speak('Newer comment.');
        await expect(first).resolves.toBe(false);
        const cancellations = cancel.mock.calls.length;
        await vi.advanceTimersByTimeAsync(11_000);
        expect(cancel).toHaveBeenCalledTimes(cancellations);
        expect(service.state()).toBe('speaking');
        speak.mock.calls[1][0].onend?.();
        await expect(second).resolves.toBe(true);
    });

    it('falls back to browser speech when AI audio is invalid or blocked', async () => {
        const service = TestBed.inject(LiveCoachNarratorService);
        await expect(service.speak('Keep your size consistent.', 1,
            { mimeType: 'audio/mpeg', base64: 'not audio' })).resolves.toBe(true);
        expect(speak.mock.calls[0][0].text).toBe('Keep your size consistent.');
        expect(service.voiceFallback()).toBe(true);
    });

    it('decodes bounded AI audio, applies pace, and releases it on stop', async () => {
        const source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(),
            start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
        const context = { state: 'running', destination: {}, createBufferSource: () => source,
            decodeAudioData: vi.fn(async () => ({ duration: 2 })), close: vi.fn(async () => {}) };
        vi.stubGlobal('AudioContext', class { constructor() { return context; } });
        const service = TestBed.inject(LiveCoachNarratorService);
        await service.activate();
        const pending = service.speak('AI comment.', 1.2, { mimeType: 'audio/mpeg', base64: 'YWJj' });
        await vi.advanceTimersByTimeAsync(1);
        expect(source.start).toHaveBeenCalledOnce();
        expect(source.playbackRate.value).toBe(1.2);
        expect(speak).not.toHaveBeenCalled();
        service.stop();
        await expect(pending).resolves.toBe(false);
        expect(source.disconnect).toHaveBeenCalled();
    });

    it('releases a failed audio source and reads the same comment with browser speech', async () => {
        const source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(),
            start: vi.fn(() => { throw new Error('Audio device unavailable'); }), stop: vi.fn(), onended: null };
        vi.stubGlobal('AudioContext', class {
            state = 'running'; destination = {};
            createBufferSource = () => source;
            decodeAudioData = async () => ({ duration: 2 });
            close = async () => {};
        });
        const service = TestBed.inject(LiveCoachNarratorService);
        await service.activate();
        await expect(service.speak('Keep your size consistent.', 1,
            { mimeType: 'audio/mpeg', base64: 'YWJj' })).resolves.toBe(true);
        expect(source.disconnect).toHaveBeenCalled();
        expect(source.stop).toHaveBeenCalled();
        expect(speak.mock.calls[0][0].text).toBe('Keep your size consistent.');
        expect(service.voiceFallback()).toBe(true);
    });
});
