import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AlertSoundPickerComponent } from './alert-sound-picker.component';
import { SessionAlertsService } from './session-alerts.service';

describe('sound picker audition controls', () => {
    function setup() {
        const preview = vi.fn(async () => {});
        TestBed.configureTestingModule({ providers: [{ provide: SessionAlertsService, useValue: {
            enabled: signal(true), previewing: signal(false), preferences: signal({ volume: 45 }), error: signal(null), preview,
        } }] });
        const fixture = TestBed.createComponent(AlertSoundPickerComponent);
        fixture.componentRef.setInput('kind', 'open');
        fixture.componentRef.setInput('label', 'Session opening');
        fixture.componentRef.setInput('value', 'stock-market-bell');
        const changed = vi.fn(); fixture.componentInstance.changed.subscribe(changed);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const trigger = element.querySelector<HTMLButtonElement>('.sound-picker__trigger')!;
        trigger.click(); fixture.detectChanges();
        return { fixture, element, trigger, changed, preview };
    }
    it('previews a different sound without saving or closing the picker', async () => {
        const { fixture, element, changed, preview } = setup();
        element.querySelector<HTMLButtonElement>('[aria-label="Preview Hell yeah"]')!.click();
        await fixture.whenStable();
        expect(preview).toHaveBeenCalledWith('open', 'hell-yeah');
        expect(changed).not.toHaveBeenCalled();
        expect(fixture.componentInstance.value()).toBe('stock-market-bell');
        expect(fixture.componentInstance.open()).toBe(true);
    });
    it('closes on outside click and Escape, restoring focus for keyboard dismissal', async () => {
        const { fixture, trigger } = setup();
        await fixture.whenStable();
        document.body.click(); fixture.detectChanges();
        expect(fixture.componentInstance.open()).toBe(false);
        trigger.click(); fixture.detectChanges();
        await fixture.whenStable();
        fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(fixture.componentInstance.open()).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });
    it('only applies a sound when its selection button is clicked', () => {
        const { fixture, element, changed, preview } = setup();
        [...element.querySelectorAll<HTMLButtonElement>('.sound-picker__choice')]
            .find(button => button.textContent?.includes('Game over'))!.click();
        expect(changed).toHaveBeenCalledWith('game-over');
        expect(preview).not.toHaveBeenCalled();
        expect(fixture.componentInstance.open()).toBe(false);
    });
    it('shows a flat list with a mute icon for Silent and no inherited default control', () => {
        const { fixture, element, trigger, changed, preview } = setup();
        fixture.componentRef.setInput('kind', 'dailyLoss');
        fixture.detectChanges();
        expect(element.querySelector('.sound-picker__group')).toBeNull();
        expect(element.querySelectorAll('.sound-picker__choice')).toHaveLength(12);
        expect(element.textContent).not.toContain('warning default');
        const silent = [...element.querySelectorAll<HTMLButtonElement>('.sound-picker__choice')]
            .find(button => button.textContent?.trim() === 'Silent')!;
        expect(silent.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
        silent.click();
        expect(changed).toHaveBeenCalledWith('silent');
        expect(preview).not.toHaveBeenCalled();
        fixture.componentRef.setInput('value', 'silent');
        fixture.detectChanges();
        expect(trigger.querySelector('svg')).not.toBeNull();
        expect(trigger.textContent).toContain('Silent');
    });
});
