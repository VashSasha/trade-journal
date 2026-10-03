import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrokerPickerComponent } from './broker-picker.component';

describe('broker picker', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('offers only supported brokers and reuses the existing Tradovate logo', () => {
        const fixture = TestBed.createComponent(BrokerPickerComponent);
        const selected = vi.fn(); fixture.componentInstance.brokerSelected.subscribe(selected);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const buttons = root.querySelectorAll<HTMLButtonElement>('.broker-picker__broker');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].getAttribute('aria-label')).toBe('Connect Tradovate');
        expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe('/brokers/tradovate-icon.png');
        expect(root.querySelector('.broker-picker__coming')?.textContent).toContain('only supported connection');
        expect(root.querySelector('.broker-picker__coming button')).toBeNull();
        expect(selected).not.toHaveBeenCalled();
        buttons[0].click(); expect(selected).toHaveBeenCalledExactlyOnceWith('tradovate');
    });

    it('focuses its heading and allows cancellation without selecting a broker', async () => {
        const fixture = TestBed.createComponent(BrokerPickerComponent);
        const cancel = vi.fn(); fixture.componentInstance.cancelled.subscribe(cancel);
        await fixture.whenStable();
        const root = fixture.nativeElement as HTMLElement;
        expect(document.activeElement).toBe(root.querySelector('h2'));
        root.querySelector<HTMLButtonElement>('.broker-picker__close')!.click();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
