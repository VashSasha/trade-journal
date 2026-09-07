import { REFERENCE_SESSIONS, SessionDefinition } from './sessions.model';
import { getSessionsSnapshot, sessionCountdown, sessionWallTime, sessionWindowOn } from './sessions.utils';

const at = (value: string) => Date.parse(value);
const [asia, london, newYork] = REFERENCE_SESSIONS;
const overnight: SessionDefinition = {
    id: 'overnight', name: 'Overnight', city: 'New York', timeZone: 'America/New_York',
    openMinute: 22 * 60, closeMinute: 6 * 60, weekdays: [1, 2, 3, 4, 5, 6],
};

describe('reference session windows', () => {
    it.each([
        [asia, '2026-01-12', '2026-01-12T00:00Z', '2026-01-12T09:00Z'],
        [london, '2026-01-12', '2026-01-12T08:00Z', '2026-01-12T17:00Z'],
        [newYork, '2026-01-12', '2026-01-12T14:30Z', '2026-01-12T21:00Z'],
        [asia, '2026-07-06', '2026-07-06T00:00Z', '2026-07-06T09:00Z'],
        [london, '2026-07-06', '2026-07-06T07:00Z', '2026-07-06T16:00Z'],
        [newYork, '2026-07-06', '2026-07-06T13:30Z', '2026-07-06T20:00Z'],
        // US and UK change clocks on different weekends.
        [newYork, '2026-03-16', '2026-03-16T13:30Z', '2026-03-16T20:00Z'],
        [london, '2026-03-16', '2026-03-16T08:00Z', '2026-03-16T17:00Z'],
        [newYork, '2026-10-26', '2026-10-26T13:30Z', '2026-10-26T20:00Z'],
        [london, '2026-10-26', '2026-10-26T08:00Z', '2026-10-26T17:00Z'],
    ])('converts %s on %s to absolute instants', (definition, date, start, end) => {
        const window = sessionWindowOn(definition, date)!;
        expect(window.opensAt).toBe(at(start));
        expect(window.closesAt).toBe(at(end));
    });

    it('uses start-inclusive and end-exclusive boundaries', () => {
        expect(getSessionsSnapshot(at('2026-07-06T13:29:59.999Z'), [newYork]).active).toHaveLength(0);
        const opening = getSessionsSnapshot(at('2026-07-06T13:30Z'), [newYork]);
        expect(opening.active).toHaveLength(1);
        expect(opening.active[0].progress).toBe(0);
        expect(getSessionsSnapshot(at('2026-07-06T19:59:59.999Z'), [newYork]).active).toHaveLength(1);
        expect(getSessionsSnapshot(at('2026-07-06T20:00Z'), [newYork]).active).toHaveLength(0);
    });

    it('keeps overlaps and sorts the next closing first', () => {
        const state = getSessionsSnapshot(at('2026-07-06T14:00Z'));
        expect(state.active.map(s => s.definition.id)).toEqual(['london', 'new-york']);
        expect(state.active[0].progress).toBeCloseTo(100 * 7 / 9);
        expect(state.active[1].progress).toBeCloseTo(100 / 13);
        expect(state.next?.definition.id).toBe('asia');
        expect(state.next?.opensAt).toBe(at('2026-07-07T00:00Z'));
    });

    it('includes the Asia/London overlap', () => {
        expect(getSessionsSnapshot(at('2026-07-06T08:00Z')).active.map(s => s.definition.id))
            .toEqual(['asia', 'london']);
    });

    it('finds Monday after the weekend using each city’s calendar', () => {
        const weekend = getSessionsSnapshot(at('2026-07-04T14:00Z'));
        expect(weekend.active).toHaveLength(0);
        expect(weekend.next?.opensAt).toBe(at('2026-07-06T00:00Z'));
        // Sunday evening in the Americas is already Monday morning in Tokyo.
        const mondayTokyo = getSessionsSnapshot(at('2026-07-05T19:00-05:00'));
        expect(mondayTokyo.active.map(s => s.definition.id)).toEqual(['asia']);
        expect(mondayTokyo.active[0].current?.localDate).toBe('2026-07-06');
    });

    it('does not imply that a public holiday means every exchange is closed', () => {
        expect(sessionWindowOn(newYork, '2026-12-25')).not.toBeNull();
    });

    it('keeps a Friday overnight window active on Saturday', () => {
        const state = getSessionsSnapshot(at('2026-07-04T08:00Z'), [overnight]);
        expect(state.active[0].current?.localDate).toBe('2026-07-03');
        expect(state.active[0].current?.closesAt).toBe(at('2026-07-04T10:00Z'));
        expect(state.active[0].progress).toBe(75);
    });

    it.each([
        ['2026-03-07', 7], // Clock jumps forward during the window.
        ['2026-10-31', 9], // Clock repeats an hour during the window.
    ])('uses elapsed time across the DST change on %s', (date, hours) => {
        const window = sessionWindowOn(overnight, date)!;
        expect(window.closesAt - window.opensAt).toBe(hours * 3_600_000);
        const midpoint = (window.opensAt + window.closesAt) / 2;
        expect(getSessionsSnapshot(midpoint, [overnight]).active[0].progress).toBe(50);
    });

    it('rejects a nonexistent DST boundary rather than silently shifting it', () => {
        expect(() => sessionWindowOn({ ...overnight, openMinute: 150, weekdays: [0] }, '2026-03-08'))
            .toThrow('does not exist');
    });

    it('uses the first repeated-hour opening and the last repeated-hour closing', () => {
        const opening = sessionWindowOn({ ...overnight, openMinute: 90, weekdays: [0] }, '2026-11-01')!;
        expect(opening.opensAt).toBe(at('2026-11-01T05:30Z'));
        const closing = sessionWindowOn({ ...overnight, closeMinute: 90 }, '2026-10-31')!;
        expect(closing.closesAt).toBe(at('2026-11-01T06:30Z'));
    });

    it('finds a once-a-week window seven days ahead', () => {
        const state = getSessionsSnapshot(at('2026-07-06T23:00Z'), [{ ...newYork, weekdays: [1] }]);
        expect(state.next?.opensAt).toBe(at('2026-07-13T13:30Z'));
    });

    it('handles no scheduled sessions without inventing an opening', () => {
        const state = getSessionsSnapshot(at('2026-07-06T13:00Z'), []);
        expect(state.sessions).toEqual([]);
        expect(state.active).toEqual([]);
        expect(state.next).toBeNull();
    });

    it('validates dates, zones, definitions and clock input', () => {
        expect(() => sessionWindowOn(asia, '2026-02-30')).toThrow(RangeError);
        expect(() => sessionWindowOn({ ...asia, timeZone: 'Not/A_Zone' }, '2026-07-06')).toThrow(RangeError);
        expect(() => sessionWindowOn({ ...asia, openMinute: -1 }, '2026-07-06')).toThrow(RangeError);
        expect(() => getSessionsSnapshot(NaN)).toThrow(RangeError);
        expect(() => getSessionsSnapshot(Date.now(), [asia, asia])).toThrow('must be unique');
    });
});

describe('session labels', () => {
    it.each([[1, '1m'], [60_001, '2m'], [3_600_000, '1h'], [5_100_000, '1h 25m'], [176_400_000, '2d 1h']])
        ('formats %s milliseconds without showing zero minutes before a boundary', (duration, label) => {
            expect(sessionCountdown(duration)).toBe(label);
        });
    it('formats local preset hours', () => {
        expect(sessionWallTime(9 * 60)).toBe('09:00');
        expect(sessionWallTime(17 * 60 + 30)).toBe('17:30');
    });
});
