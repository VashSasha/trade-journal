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
        cancel.mockReset();
        speak.mockClear();
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
        Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: { cancel, speak },
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        vi.unstubAllGlobals();
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
});
