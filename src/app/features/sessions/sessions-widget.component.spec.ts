import { TestBed } from '@angular/core/testing';
import { SessionsWidgetComponent } from './sessions-widget.component';

describe('Sessions widget', () => {
    function setup(instant = '2026-07-06T13:00Z') {
        const fixture = TestBed.createComponent(SessionsWidgetComponent);
        fixture.componentInstance.clock.now.set(Date.parse(instant));
        fixture.componentInstance.displayZone.set('UTC');
        fixture.detectChanges();
        return { fixture, widget: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
    }

    it('renders independently with overlap progress and explicit reference-window caveats', () => {
        const { element, widget } = setup();
        expect(widget.title()).toBe('London + New York');
        expect(widget.detail()).toBe('London ends in 3h');
        expect(element.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
        expect(element.textContent).toContain('holidays, maintenance and early closes are not');
        expect(element.textContent).toContain('Mon–Fri · 09:00–18:00 · Asia/Tokyo');
    });

    it('shows the next reference window between sessions', () => {
        const { widget } = setup('2026-07-06T22:00Z');
        expect(widget.title()).toBe('Between sessions');
        expect(widget.detail()).toBe('Asia in 2h');
    });

    it('changes displayed times without changing session membership or instants', () => {
        const { widget, element, fixture } = setup();
        const snapshot = widget.snapshot();
        const window = snapshot!.active[0].current!;
        expect(widget.formatWindow(window)).toContain('07:00');
        const select = element.querySelector('select')!;
        select.value = 'America/New_York';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        expect(widget.formatWindow(window)).toContain('03:00');
        expect(widget.snapshot()).toBe(snapshot);
    });

    it('preserves both calendar dates for a window crossing midnight in the display zone', () => {
        const { widget } = setup('2026-07-06T02:00Z');
        widget.displayZone.set('America/New_York');
        const range = widget.formatWindow(widget.snapshot()!.active[0].current!);
        expect(range).toContain('Jul 5');
        expect(range).toContain('Jul 6');
        expect(range).toContain('20:00');
        expect(range).toContain('05:00');
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
