import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PerformanceAlertControlsComponent } from './performance-alert-controls.component';
import { PerformanceAlertsService } from './performance-alerts.service';
import { parsePerformanceAlertPreferences } from './performance-alerts.utils';

describe('performance guardrail controls', () => {
    function setup() {
        const preferences = signal(parsePerformanceAlertPreferences(null));
        const alerts = {
            preferences, preferencesLoading: signal(false), syncWarning: signal(false), storageWarning: signal(false),
            openPnlStatus: signal('Waiting for fresh live quotes.'),
            live: { state: signal('live'), statusLabel: signal('Live'), statusDetail: signal('Connected') },
            setEnabled: vi.fn(), setValue: vi.fn(),
            setIncludeOpenPnl: vi.fn((enabled: boolean) => preferences.update(current => ({ ...current,
                dailyProfit: { ...current.dailyProfit, includeOpenPnl: enabled } }))),
        };
        TestBed.configureTestingModule({ providers: [{ provide: PerformanceAlertsService, useValue: alerts }] });
        const fixture = TestBed.createComponent(PerformanceAlertControlsComponent);
        fixture.detectChanges();
        return { alerts, fixture, element: fixture.nativeElement as HTMLElement };
    }

    it('labels the opt-in checkbox and lets its visible label toggle the saved preference', () => {
        const { alerts, fixture, element } = setup();
        const label = [...element.querySelectorAll('label')].find(item => item.textContent?.includes('Include open P&L'));
        expect(label).toBeDefined();
        const input = label!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(input.checked).toBe(false);
        label!.click(); fixture.detectChanges();
        expect(alerts.setIncludeOpenPnl).toHaveBeenLastCalledWith(true);
        expect(input.checked).toBe(true);
        label!.click(); fixture.detectChanges();
        expect(alerts.setIncludeOpenPnl).toHaveBeenLastCalledWith(false);
        expect(input.checked).toBe(false);
    });

    it('exposes the estimate description and announces quote status only when opted in', () => {
        const { alerts, fixture, element } = setup();
        const input = element.querySelector<HTMLInputElement>('.guardrails__open-pnl input')!;
        const descriptionId = input.getAttribute('aria-describedby');
        expect(descriptionId).toBeTruthy();
        expect(element.querySelector(`#${descriptionId}`)?.textContent).toContain('no orders are placed');
        expect(element.querySelector('[role="status"]')).toBeNull();
        alerts.setIncludeOpenPnl(true); fixture.detectChanges();
        expect(element.querySelector('[role="status"]')?.textContent).toContain('Waiting for fresh live quotes');
    });

    it('keeps the full-width open-P&L control outside the narrow period grid', () => {
        const { alerts, fixture, element } = setup();
        alerts.setIncludeOpenPnl(true); fixture.detectChanges();
        const label = element.querySelector('.guardrails__open-pnl')!;
        expect(label.closest('.guardrails__period')).toBeNull();
        expect(label.parentElement?.classList.contains('guardrails__open-pnl-section')).toBe(true);
        expect(element.querySelector('.guardrails__open-pnl-details [role="status"]')).not.toBeNull();
        expect(element.querySelector('.guardrails__open-pnl-details .guardrails__note')).toBeNull();
    });
});
