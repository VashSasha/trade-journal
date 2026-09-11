import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { SessionScheduleService } from './session-schedule.service';
import { SessionScheduleControlsComponent } from './session-schedule-controls.component';
import { parseSessionPreferences, SessionPreferences } from './session-preferences';

describe('custom session schedules', () => {
    const preferences = signal(parseSessionPreferences(null));
    beforeEach(() => {
        preferences.set(parseSessionPreferences(null));
        TestBed.configureTestingModule({ providers: [{ provide: AccountAlertPreferencesService, useValue: {
            sessions: preferences, loading: signal(false), syncWarning: signal(false), storageWarning: signal(false),
            updateSessions: (update: (p: SessionPreferences) => SessionPreferences) => preferences.update(update),
        } }] });
    });

    it('normalizes malformed hours and preserves intentional disabled sessions', () => {
        expect(parseSessionPreferences('{')).toEqual(parseSessionPreferences(null));
        const parsed = parseSessionPreferences(JSON.stringify({ asia: { enabled: false, openMinute: -1, closeMinute: 0 } }));
        expect(parsed['asia']).toEqual({ enabled: false, openMinute: 1020, closeMinute: 120 });
    });

    it('shares customized hours and visibility without changing the preset zone or weekdays', () => {
        const schedule = TestBed.inject(SessionScheduleService);
        expect(schedule.setHours('asia', 1080, 180)).toBe(true);
        expect(schedule.definitions()[0]).toEqual(expect.objectContaining({ timeZone: 'America/Chicago', openMinute: 1080, closeMinute: 180, weekdays: [0, 1, 2, 3, 4] }));
        schedule.setEnabled('asia', false);
        expect(schedule.definitions().map(d => d.id)).toEqual(['london', 'new-york']);
        schedule.reset('asia');
        expect(preferences()['asia']).toEqual({ enabled: false, openMinute: 1020, closeMinute: 120 });
    });

    it('rejects invalid or equal times without changing saved preferences', () => {
        const schedule = TestBed.inject(SessionScheduleService);
        const before = preferences();
        for (const [start, end] of [[0, 0], [-1, 60], [60, 1440], [NaN, 60], [10.5, 60]]) {
            expect(schedule.setHours('asia', start, end)).toBe(false);
        }
        expect(schedule.setHours('unknown', 0, 60)).toBe(false);
        expect(preferences()).toBe(before);
    });

    function settings() {
        const fixture = TestBed.createComponent(SessionScheduleControlsComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const edit = (index = 0) => {
            root.querySelectorAll<HTMLButtonElement>('.session-settings__edit')[index].click();
            fixture.detectChanges();
        };
        const input = (index: number, value: string) => {
            const field = root.querySelectorAll<HTMLInputElement>('input[type="text"]')[index];
            field.value = value;
            field.dispatchEvent(new Event('input'));
            fixture.detectChanges();
        };
        const submit = () => {
            root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
            fixture.detectChanges();
        };
        return { fixture, root, edit, input, submit };
    }

    it('starts compact and expands only the selected editor', () => {
        const { root, edit } = settings();
        expect(root.querySelectorAll('.session-settings__summary')).toHaveLength(3);
        expect(root.querySelectorAll('form')).toHaveLength(0);
        expect(root.querySelector<HTMLDetailsElement>('.session-settings__help')?.open).toBe(false);
        edit();
        expect(root.querySelectorAll('form')).toHaveLength(1);
        expect(root.querySelector('form')?.id).toBe('session-editor-asia');
        edit(1);
        expect(root.querySelectorAll('form')).toHaveLength(1);
        expect(root.querySelector('form')?.id).toBe('session-editor-london');
    });

    it('resets unsaved edits and cancels without persisting drafts', () => {
        const { fixture, root, edit, input } = settings();
        edit();
        input(0, '9 AM');
        fixture.componentInstance.reset('asia');
        fixture.detectChanges();
        expect(root.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('5:00 PM');
        input(0, '8 PM');
        const cancel = [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!;
        cancel.click(); fixture.detectChanges();
        expect(root.querySelector('form')).toBeNull();
        expect(preferences()['asia'].openMinute).toBe(1020);
        edit();
        expect(root.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('5:00 PM');
    });

    it('saves AM/PM hours and collapses the editor after success', () => {
        const { root, edit, input, submit } = settings();
        edit(); input(0, '6 pm'); submit();
        expect(preferences()['asia'].openMinute).toBe(1080);
        expect(root.querySelector('form')).toBeNull();
        expect(root.querySelector('.session-settings__hours')?.textContent).toContain('6:00 PM');
    });

    it('rejects malformed and equal hours without overwriting saved preferences', () => {
        const { root, edit, input, submit } = settings();
        edit();
        for (const value of ['13:00 PM', '5:60 PM', '19:00', '2:00 AM']) {
            input(0, value); submit();
            expect(root.querySelector('[role="alert"]')?.textContent).toContain('must be different');
            expect(preferences()['asia'].openMinute).toBe(1020);
        }
        input(0, '12 AM'); input(1, '12 PM'); submit();
        expect(preferences()['asia'].openMinute).toBe(0);
        expect(preferences()['asia'].closeMinute).toBe(720);
    });

    it('toggles tracking from the compact settings row', () => {
        const { root, fixture } = settings();
        root.querySelector<HTMLInputElement>('[role="switch"]')!.click();
        fixture.detectChanges();
        expect(preferences()['asia'].enabled).toBe(false);
        expect(root.querySelector('form')).toBeNull();
    });
});
