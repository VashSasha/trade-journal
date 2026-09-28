import { TestBed } from '@angular/core/testing';
import { LandingProductPreviewComponent } from './landing-product-preview.component';

describe('landing product preview', () => {
    it('shows clearly labelled sample data without needing auth or broker services', async () => {
        const fixture = TestBed.createComponent(LandingProductPreviewComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('Illustrative preview');
        expect(el.textContent).toContain('No broker connection, AI request or audio playback');
        expect(el.querySelector('.product-preview__message')?.textContent).toContain('$260 realized and $80 still open');
        expect(el.querySelector('[aria-pressed="true"]')?.textContent).toBe('Live Coach');
        expect(el.querySelector('audio')).toBeNull();
    });

    it('switches between review and analytics with accessible selected states', async () => {
        const fixture = TestBed.createComponent(LandingProductPreviewComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        const buttons = el.querySelectorAll<HTMLButtonElement>('.product-preview__tab');
        buttons[1].click();
        await fixture.whenStable();
        expect(el.querySelector('[aria-pressed="true"]')?.textContent).toBe('Daily review');
        expect(el.textContent).toContain('Tomorrow’s focus');
        buttons[2].click();
        await fixture.whenStable();
        expect(el.querySelector('[aria-pressed="true"]')?.textContent).toBe('Analytics');
        expect(el.querySelectorAll('.product-preview__account-row').length).toBe(3);
        expect(el.textContent).not.toContain('Tomorrow’s focus');
    });

    it('toggles the coach example and preserves it when switching views', async () => {
        const fixture = TestBed.createComponent(LandingProductPreviewComponent);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        el.querySelector<HTMLButtonElement>('.product-preview__moment')!.click();
        await fixture.whenStable();
        expect(el.querySelector('.product-preview__message')?.textContent).toContain('12 trades across 3 accounts');
        fixture.componentInstance.selectView('review');
        await fixture.whenStable();
        fixture.componentInstance.selectView('coach');
        await fixture.whenStable();
        expect(el.querySelector('.product-preview__message')?.textContent).toContain('Copied trades');
        el.querySelector<HTMLButtonElement>('.product-preview__moment')!.click();
        await fixture.whenStable();
        expect(el.querySelector('.product-preview__message')?.textContent).toContain('$300 daily target');
    });
});
