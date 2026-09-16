import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideMarkdown } from 'ngx-markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPolicyService } from '../../core/services/access-policy.service';
import { OpenAiService } from '../../core/services/openai.service';
import { TradovateService } from '../../core/services/tradovate.service';
import { AiReportsComponent } from './ai-reports.component';
import { ReportAnalysisService } from './report-analysis.service';

describe('AI Analyzer responsive form', () => {
    afterEach(() => TestBed.resetTestingModule());

    function setup(demo = false) {
        const streamAnalysis = vi.fn();
        const saveReport = vi.fn();
        TestBed.configureTestingModule({ providers: [
            provideRouter([]), provideMarkdown(),
            { provide: AccessPolicyService, useValue: { demo: signal(demo), requestAction: () => true } },
            { provide: OpenAiService, useValue: { hasApiKey: () => true, streamAnalysis } },
            { provide: TradovateService, useValue: {} },
            { provide: ReportAnalysisService, useValue: {
                reports: signal([]), loading: signal(false), error: signal(null),
                listReports: vi.fn().mockResolvedValue(undefined), saveReport,
            } },
        ] });
        const fixture = TestBed.createComponent(AiReportsComponent);
        fixture.detectChanges();
        return { fixture, el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, streamAnalysis, saveReport };
    }

    it('exposes a labelled native image picker and connects the symbol label', () => {
        const { el } = setup();
        const file = el.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(file.getAttribute('aria-label')).toBe('Choose chart image');
        expect(file.disabled).toBe(false);
        expect(file.tabIndex).toBe(0);
        expect(el.querySelector<HTMLLabelElement>('label[for="chart-symbol"]')!.control).toBe(el.querySelector('#chart-symbol'));
        expect(el.querySelector<HTMLButtonElement>('.air-analyze-btn')!.disabled).toBe(true);
        expect(el.querySelector<HTMLButtonElement>('.air-mode-toggle__btn--soon')!.disabled).toBe(true);
    });

    it('keeps the image selection, clear action and streaming restriction intact', () => {
        const { fixture, el, component } = setup();
        component.selectedImage.set(new File(['sample'], 'chart.png', { type: 'image/png' }));
        component.imagePreview.set('data:image/png;base64,c2FtcGxl');
        fixture.detectChanges();
        expect(el.querySelector<HTMLButtonElement>('.air-analyze-btn')!.disabled).toBe(false);
        component.analysisState.set({ status: 'streaming', content: '', error: null });
        fixture.detectChanges();
        expect(el.querySelector<HTMLButtonElement>('.air-analyze-btn')!.disabled).toBe(true);
        el.querySelector<HTMLButtonElement>('[aria-label="Remove image"]')!.click();
        fixture.detectChanges();
        expect(component.selectedImage()).toBeNull();
        expect(el.querySelector('input[type="file"]')).not.toBeNull();
    });

    it('keeps demo previews isolated from uploads, history and paid AI calls', () => {
        const { el, streamAnalysis, saveReport } = setup(true);
        expect(el.textContent).toContain('SAMPLE');
        expect(el.querySelector('input[type="file"]')).toBeNull();
        expect(el.querySelector('app-saved-reports')).toBeNull();
        const toggle = el.querySelector<HTMLButtonElement>('.air-verdict__contingency-toggle')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click();
        TestBed.tick();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(streamAnalysis).not.toHaveBeenCalled();
        expect(saveReport).not.toHaveBeenCalled();
    });
});
