import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SessionsClockService } from './sessions-clock.service';

describe('scoped sessions clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-06T13:29:45Z'));
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        TestBed.configureTestingModule({ providers: [SessionsClockService] });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('recomputes session membership at the next timer tick', () => {
        const clock = TestBed.inject(SessionsClockService);
        expect(clock.state().snapshot?.active.map(s => s.definition.id)).toEqual(['london']);
        vi.advanceTimersByTime(15_000);
        expect(clock.now()).toBe(Date.parse('2026-07-06T13:30Z'));
        expect(clock.state().snapshot?.active.map(s => s.definition.id)).toEqual(['london', 'new-york']);
    });

    it('skips hidden updates and catches up immediately when shown after sleep', () => {
        const clock = TestBed.inject(SessionsClockService);
        const original = clock.now();
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        vi.advanceTimersByTime(60_000);
        expect(clock.now()).toBe(original);
        vi.setSystemTime(new Date('2026-07-07T02:00Z'));
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(clock.now()).toBe(Date.now());
        expect(clock.state().snapshot?.active.map(s => s.definition.id)).toEqual(['asia']);
    });

    it('also catches up on window focus', () => {
        const clock = TestBed.inject(SessionsClockService);
        vi.setSystemTime(new Date('2026-07-06T22:00Z'));
        window.dispatchEvent(new Event('focus'));
        expect(clock.now()).toBe(Date.now());
        expect(clock.state().snapshot?.active).toEqual([]);
    });

    it('removes its timer and wake listeners when destroyed', () => {
        const clock = TestBed.inject(SessionsClockService);
        const original = clock.now();
        const clear = vi.spyOn(window, 'clearInterval');
        const removeDocument = vi.spyOn(document, 'removeEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        TestBed.resetTestingModule();
        expect(clear).toHaveBeenCalledOnce();
        expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function));
        vi.advanceTimersByTime(30_000);
        window.dispatchEvent(new Event('focus'));
        expect(clock.now()).toBe(original);
    });

    it('fails visibly if the clock cannot produce valid session times', () => {
        const clock = TestBed.inject(SessionsClockService);
        clock.now.set(NaN);
        expect(clock.state().snapshot).toBeNull();
        expect(clock.state().error).toContain('unavailable');
    });
});
