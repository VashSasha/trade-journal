import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsLensComponent } from './analytics-lens.component';

describe('analytics grouping controls', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('retains the same grouping actions and selected state in the responsive control', () => {
        const fixture = TestBed.createComponent(AnalyticsLensComponent);
        fixture.componentRef.setInput('trades', []); fixture.detectChanges();
        const changed = vi.fn();
        fixture.componentInstance.unitChange.subscribe(changed);
        const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        buttons[0].click(); expect(changed).not.toHaveBeenCalled();
        buttons[1].click(); expect(changed).toHaveBeenLastCalledWith('position');
        fixture.componentRef.setInput('unit', 'position'); fixture.detectChanges();
        expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
        expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
        buttons[2].click(); expect(changed).toHaveBeenLastCalledWith('execution');
        expect(fixture.nativeElement.textContent).toContain('No closed trades in this period');
    });
});
