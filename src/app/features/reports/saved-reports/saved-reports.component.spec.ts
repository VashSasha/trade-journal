import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_VERDICT } from '../demo-verdict';
import { ReportAnalysisService, SavedReport } from '../report-analysis.service';
import { SavedReportsComponent } from './saved-reports.component';

describe('saved report interactions', () => {
    afterEach(() => TestBed.resetTestingModule());

    function setup() {
        const reports = signal<SavedReport[]>([
            { id: 'first', title: 'A long chart analysis title with account and session context', verdict: DEMO_VERDICT, createdAt: new Date().toISOString() },
            { id: 'second', title: 'Another session', verdict: DEMO_VERDICT, createdAt: new Date().toISOString() },
        ]);
        const service = { reports, loading: signal(false), error: signal<string | null>(null), listReports: vi.fn(), deleteReport: vi.fn() };
        TestBed.configureTestingModule({ providers: [{ provide: ReportAnalysisService, useValue: service }] });
        const fixture = TestBed.createComponent(SavedReportsComponent);
        fixture.detectChanges();
        return { fixture, el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, service };
    }

    it('opens the requested report with an accessible title and associated content', () => {
        const { fixture, el, service } = setup();
        const toggles = el.querySelectorAll<HTMLButtonElement>('.sr-item__toggle');
        expect(toggles[0].textContent).toContain(service.reports()[0].title);
        toggles[0].click(); fixture.detectChanges();
        expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
        expect(el.querySelector('#' + toggles[0].getAttribute('aria-controls'))).not.toBeNull();
        toggles[1].click(); fixture.detectChanges();
        expect(el.querySelector('#saved-report-first')).toBeNull();
        expect(el.querySelector('#saved-report-second')).not.toBeNull();
        expect(service.deleteReport).not.toHaveBeenCalled();
    });

    it('keeps delete separate from expand and disables it while pending', async () => {
        const { fixture, el, component, service } = setup();
        let finish!: () => void;
        service.deleteReport.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
        const pending = component.deleteReport('first'); fixture.detectChanges();
        const button = el.querySelector<HTMLButtonElement>('.sr-item__delete')!;
        expect(button.getAttribute('aria-label')).toBe('Delete report: ' + service.reports()[0].title);
        expect(button.disabled).toBe(true);
        expect(component.expandedId()).toBeNull();
        expect(service.deleteReport).toHaveBeenCalledExactlyOnceWith('first');
        finish(); await pending; fixture.detectChanges();
        expect(button.disabled).toBe(false);
    });

    it('renders loading, empty and error states without dropping history locally', () => {
        const { fixture, el, service } = setup();
        service.loading.set(true); fixture.detectChanges();
        expect(el.textContent).toContain('Loading saved reports');
        service.loading.set(false); service.error.set('Could not load saved reports.'); fixture.detectChanges();
        expect(el.textContent).toContain('Could not load saved reports.');
        expect(service.reports()).toHaveLength(2);
        service.error.set(null); service.reports.set([]); fixture.detectChanges();
        expect(el.textContent).toContain('No saved reports yet');
    });
});
