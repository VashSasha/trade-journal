import { Component, signal, ViewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GridStack } from 'gridstack';
import { GridstackComponent } from 'gridstack/dist/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WidgetGridComponent } from './widget-grid.component';

@Component({
    standalone: true, imports: [WidgetGridComponent],
    template: `@if (desktop()) { <app-widget-grid [options]="options" /> } @else { <p>Phone widgets</p> }`,
})
class TestHost {
    readonly desktop = signal(true);
    readonly options = { column: 12, auto: false, cellHeight: 50, children: [] };
    @ViewChild(GridstackComponent) grid?: GridstackComponent;
}

describe('Angular-owned widget grid', () => {
    afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    function setup() {
        vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
        TestBed.configureTestingModule({});
        const fixture = TestBed.createComponent(TestHost);
        fixture.detectChanges();
        return fixture;
    }

    it('cleans up an already detached grid without interrupting phone rendering or remounting', () => {
        const fixture = setup();
        const host = fixture.componentInstance;
        const destroy = vi.spyOn(GridStack.prototype, 'destroy');
        expect(host.grid?.grid).toBeDefined();
        // Reproduce Angular @if detaching the host before the library destroy hook.
        host.grid!.el.remove();
        host.desktop.set(false);
        expect(() => fixture.detectChanges()).not.toThrow();
        expect(destroy).toHaveBeenCalledWith(false);
        expect(fixture.nativeElement.textContent).toContain('Phone widgets');
        host.desktop.set(true); fixture.detectChanges();
        expect(host.grid?.grid?.getColumn()).toBe(12);
        host.desktop.set(false);
        expect(() => fixture.detectChanges()).not.toThrow();
    });

    it('releases the grid on page teardown and allows the next page to mount', () => {
        const fixture = setup();
        const grid = fixture.componentInstance.grid!;
        const el = grid.el;
        expect(() => fixture.destroy()).not.toThrow();
        expect(grid.grid).toBeUndefined();
        expect(el.gridstack).toBeUndefined();
        const next = TestBed.createComponent(TestHost); next.detectChanges();
        expect(next.componentInstance.grid?.grid).toBeDefined();
    });
});
