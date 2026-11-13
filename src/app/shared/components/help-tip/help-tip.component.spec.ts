import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FocusMonitor } from '@angular/cdk/a11y';
import { CdkScrollable, ScrollDispatcher } from '@angular/cdk/scrolling';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatTooltip } from '@angular/material/tooltip';
import { vi } from 'vitest';
import { HelpTipComponent } from './help-tip.component';

@Component({
    standalone: true,
    imports: [HelpTipComponent, CdkScrollable],
    template: `<main cdkScrollable><app-help-tip label="About this setting" [text]="text()" /></main>`,
})
class TooltipHost {
    readonly text = signal('Extra information about this setting.');
}

describe('standard help tooltip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        TestBed.configureTestingModule({ providers: [
            { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ] });
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280);
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    });
    afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

    function setup() {
        const fixture = TestBed.createComponent(TooltipHost);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const button = element.querySelector('button')!;
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(280, 100, 32, 32));
        const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        const visibleTooltip = () => overlay.querySelector('.mat-mdc-tooltip-show');
        const tick = async () => { await vi.advanceTimersByTimeAsync(200); fixture.detectChanges(); };
        return { fixture, element, button, tooltip, overlay, visibleTooltip, tick };
    }

    it('uses Material with the application theme and an accessible description', async () => {
        const { element, button, tooltip, tick } = setup();
        await tick();
        expect(button.type).toBe('button');
        expect(button.getAttribute('aria-label')).toBe('About this setting');
        const description = document.getElementById(button.getAttribute('aria-describedby')!);
        expect(description?.textContent).toContain('Extra information');
        expect(tooltip.tooltipClass).toBe('nvzn-help-tooltip');
        expect(element.querySelector('[popover]')).toBeNull();
        expect(button.hasAttribute('title')).toBe(false);
    });

    it('opens on hover without a click and dismisses when the pointer leaves', async () => {
        const { button, visibleTooltip, tick } = setup();
        button.dispatchEvent(new MouseEvent('mouseenter'));
        await tick();
        expect(visibleTooltip()).not.toBeNull();
        button.dispatchEvent(new MouseEvent('mouseleave'));
        await tick();
        expect(visibleTooltip()).toBeNull();
    });

    it('supports keyboard focus and Escape dismissal', async () => {
        const { button, visibleTooltip, tick } = setup();
        TestBed.inject(FocusMonitor).focusVia(button, 'keyboard');
        await tick();
        expect(visibleTooltip()).not.toBeNull();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await tick();
        expect(visibleTooltip()).toBeNull();
    });

    it('supports tap/click and removes the overlay when destroyed', async () => {
        const { fixture, button, overlay, visibleTooltip, tick } = setup();
        button.click(); await tick();
        expect(visibleTooltip()).not.toBeNull();
        fixture.destroy();
        expect(overlay.querySelector('.mat-mdc-tooltip')).toBeNull();
    });

    it('repositions through the real scroll strategy when the page container scrolls', async () => {
        const { fixture, element, button, tooltip, tick } = setup();
        const scrollable = fixture.debugElement.query(By.directive(CdkScrollable)).injector.get(CdkScrollable);
        expect(TestBed.inject(ScrollDispatcher).scrollContainers.has(scrollable)).toBe(true);
        button.click(); await tick();
        const strategy = tooltip._overlayRef!.getConfig().positionStrategy!;
        const reposition = vi.spyOn(strategy, 'apply');
        element.querySelector('main')!.dispatchEvent(new Event('scroll'));
        await tick();
        expect(reposition).toHaveBeenCalled();
    });

    it('renders help as plain text, never injected HTML', async () => {
        const { fixture, button, overlay, tick } = setup();
        fixture.componentInstance.text.set('<img src=x onerror=alert(1)>');
        fixture.detectChanges();
        button.click(); await tick();
        expect(overlay.querySelector('img')).toBeNull();
        expect(overlay.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
