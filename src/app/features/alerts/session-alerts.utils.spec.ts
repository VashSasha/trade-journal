import { getSessionsSnapshot } from '../sessions/sessions.utils';
import { crossedSessionAlerts, DEFAULT_SESSION_SOUNDS, parseSoundPreferences } from './session-alerts.utils';

describe('session alert boundaries', () => {
    it('detects an opening once, including a DST-shifted New York opening', () => {
        const before = getSessionsSnapshot(Date.parse('2026-03-16T11:59:50Z'));
        const now = Date.parse('2026-03-16T12:00:05Z');
        expect(crossedSessionAlerts(before, now)).toEqual([expect.objectContaining({
            kind: 'open', at: Date.parse('2026-03-16T12:00Z'), text: 'New York reference window started.',
        })]);
        expect(crossedSessionAlerts(getSessionsSnapshot(now), now + 10_000)).toEqual([]);
    });
    it('detects a closing even though it is no longer in the new active-session list', () => {
        const before = getSessionsSnapshot(Date.parse('2026-07-06T15:59:50Z'));
        expect(crossedSessionAlerts(before, Date.parse('2026-07-06T16:00Z'))[0])
            .toMatchObject({ kind: 'close', text: 'London reference window ended.' });
    });
    it('does not replay a backlog after sleep or a backwards clock change', () => {
        const before = getSessionsSnapshot(Date.parse('2026-07-06T11:59:50Z'));
        expect(crossedSessionAlerts(before, before.now + 91_000)).toEqual([]);
        expect(crossedSessionAlerts(before, before.now - 10_000)).toEqual([]);
        expect(crossedSessionAlerts(before, NaN)).toEqual([]);
    });
    it('does not synthesize weekend events', () => {
        const before = getSessionsSnapshot(Date.parse('2026-07-04T11:59:50Z'));
        expect(crossedSessionAlerts(before, before.now + 20_000)).toEqual([]);
    });
    it('returns simultaneous boundaries together for one coalesced sound', () => {
        const defs = [
            { id: 'a', name: 'A', city: 'A', timeZone: 'UTC', openMinute: 11 * 60, closeMinute: 12 * 60, weekdays: [1] },
            { id: 'b', name: 'B', city: 'B', timeZone: 'UTC', openMinute: 12 * 60, closeMinute: 13 * 60, weekdays: [1] },
        ];
        const before = getSessionsSnapshot(Date.parse('2026-07-06T11:59:50Z'), defs);
        expect(crossedSessionAlerts(before, before.now + 20_000).map(e => e.kind)).toEqual(['close', 'open']);
    });
});

describe('sound preference validation', () => {
    it.each([null, 'bad json', 'null', '42', '"text"'])('uses safe defaults for %s', raw => {
        expect(parseSoundPreferences(raw)).toEqual(DEFAULT_SESSION_SOUNDS);
    });
    it('clamps volume and drops unexpected properties including enabled state', () => {
        expect(parseSoundPreferences('{"volume":1000,"opens":false,"closes":"yes","enabled":true}'))
            .toEqual({ volume: 100, opens: false, closes: true, armed: false });
        expect(parseSoundPreferences('{"volume":-10}').volume).toBe(0);
    });
    it('restores only a valid explicit opt-in', () => {
        expect(parseSoundPreferences('{"volume":45,"opens":true,"closes":false,"armed":true}').armed).toBe(true);
        expect(parseSoundPreferences('{"volume":0,"opens":true,"armed":true}').armed).toBe(false);
        expect(parseSoundPreferences('{"volume":45,"opens":false,"closes":false,"armed":true}').armed).toBe(true);
    });
});
