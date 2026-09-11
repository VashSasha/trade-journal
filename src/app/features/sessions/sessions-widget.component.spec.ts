import { TestBed } from '@angular/core/testing';
import { SessionsWidgetComponent } from './sessions-widget.component';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AccountAlertPreferencesService } from '../alerts/account-alert-preferences.service';
import { parseSessionPreferences, SessionPreferences } from './session-preferences';

describe('Sessions widget', () => {
    const preferences = signal(parseSessionPreferences(null));
    beforeEach(() => {
        preferences.set(parseSessionPreferences(null));
        TestBed.configureTestingModule({ providers: [provideRouter([]),
            { provide: AccountAlertPreferencesService, useValue: {
                sessions: preferences, loading: signal(false), syncWarning: signal(false), storageWarning: signal(false),
                updateSessions: (update: (p: SessionPreferences) => SessionPreferences) => preferences.update(update),
            } },
        ] });
    });
    function setup(instant = '2026-07-06T14:00Z') {
        const fixture = TestBed.createComponent(SessionsWidgetComponent);
        fixture.componentInstance.clock.now.set(Date.parse(instant));
        fixture.componentInstance.displayZone.set('UTC');
        fixture.detectChanges();
        return { fixture, widget: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
    }

    it('renders independently with overlap progress and explicit reference-window caveats', () => {
        const { element, widget } = setup();
        expect(widget.title()).toBe('London + New York');
        expect(widget.detail()).toBe('London ends in 2h');
        expect(element.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
        expect(element.textContent).toContain('holidays, maintenance and early closes are not');
        expect(element.textContent).toContain('Sun–Thu starts · 5:00 PM–2:00 AM (+1 day) · America/Chicago');
    });

    it('shows the next reference window between sessions', () => {
        const { widget } = setup('2026-07-06T21:00Z');
        expect(widget.title()).toBe('Between sessions');
        expect(widget.detail()).toBe('Asia / Overnight in 1h');
    });

    it('changes displayed times without changing session membership or instants', () => {
        const { widget, fixture } = setup();
        const snapshot = widget.snapshot();
        const window = snapshot!.active[0].current!;
        expect(widget.formatWindow(window)).toContain('7:00');
        widget.displayZone.set('America/New_York');
        fixture.detectChanges();
        expect(widget.formatWindow(window)).toContain('3:00');
        expect(widget.formatWindow(window)).toContain('AM');
        expect(widget.snapshot()).toBe(snapshot);
    });

    it('preserves both calendar dates for a window crossing midnight in the display zone', () => {
        const { widget } = setup('2026-07-06T02:00Z');
        widget.displayZone.set('America/New_York');
        const range = widget.formatWindow(widget.snapshot()!.active[0].current!);
        expect(range).toContain('Jul 5');
        expect(range).toContain('Jul 6');
        expect(range).toContain('6:00');
        expect(range).toContain('PM');
        expect(range).toContain('3:00');
        expect(range).toContain('AM');
    });

    it('is read-only and reflects session preferences changed in Settings', () => {
        const { widget, element, fixture } = setup();
        expect(element.querySelectorAll('input, select, app-session-alert-controls')).toHaveLength(0);
        expect(element.querySelector('a[href="/account/alerts"]')?.textContent).toContain('Session & sound settings');
        preferences.update(p => Object.fromEntries(Object.entries(p).map(([id, pref]) => [id, { ...pref, enabled: false }])));
        fixture.detectChanges();
        expect(widget.title()).toBe('No sessions selected');
        expect(element.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
        preferences.update(p => ({ ...p, london: { ...p['london'], enabled: true } }));
        fixture.detectChanges();
        expect(widget.title()).toBe('London');
    });

    it('wires native light-dismiss controls and reflects open/closed state accessibly', () => {
        const { widget, element, fixture } = setup();
        const trigger = element.querySelector<HTMLButtonElement>('.sessions__trigger')!;
        const panel = element.querySelector<HTMLElement>('[popover]')!;
        expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
        expect(panel.getAttribute('popover')).toBe('auto');
        expect(element.querySelector('.sessions__close')?.getAttribute('popovertargetaction')).toBe('hide');
        for (const newState of ['open', 'closed']) {
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: newState });
            panel.dispatchEvent(event);
            fixture.detectChanges();
            expect(widget.opened()).toBe(newState === 'open');
            expect(trigger.getAttribute('aria-expanded')).toBe(String(newState === 'open'));
        }
    });

    it('does not reuse IDs when multiple independent widgets are rendered', () => {
        const first = setup();
        const second = setup();
        expect(first.widget.panelId).not.toBe(second.widget.panelId);
        expect(first.widget.clock).not.toBe(second.widget.clock);
    });

    it('shows a clear unavailable state instead of fabricated session progress', () => {
        const { widget, element, fixture } = setup();
        widget.clock.now.set(NaN);
        fixture.detectChanges();
        expect(widget.title()).toBe('Unavailable');
        expect(element.querySelector('[role="status"]')?.textContent).toContain('unavailable');
        expect(element.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    });
});
