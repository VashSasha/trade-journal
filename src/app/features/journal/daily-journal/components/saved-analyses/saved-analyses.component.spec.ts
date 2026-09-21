import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { vi } from 'vitest';
import { AiAnalysisService, SavedAnalysis } from './ai-analysis.service';
import { SavedAnalysesComponent } from './saved-analyses.component';

describe('SavedAnalysesComponent', () => {
    function setup() {
        const service = {
            analyses: signal<SavedAnalysis[]>([]),
            loading: signal(false),
            error: signal<string | null>(null),
            listAnalyses: vi.fn().mockResolvedValue(undefined),
            deleteAnalysis: vi.fn().mockResolvedValue(undefined),
        };
        TestBed.configureTestingModule({
            imports: [SavedAnalysesComponent],
            providers: [provideMarkdown(), { provide: AiAnalysisService, useValue: service }],
        });
        const fixture = TestBed.createComponent(SavedAnalysesComponent);
        fixture.componentRef.setInput('date', '2026-09-18');
        fixture.detectChanges();
        return { fixture, service };
    }
    const analysis: SavedAnalysis = {
        id: 'saved-1', date: '2026-09-18', content: '## Summary\nA patient session.', createdAt: '2026-09-18T18:00:00Z',
    };

    it('stays quiet for an empty day but shows loading even without any records', () => {
        const { fixture, service } = setup();
        expect(fixture.nativeElement.querySelector('.sa')).toBeNull();
        service.loading.set(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Loading saved coaching');
    });

    it('hides stale records while loading or failed and allows a retry for the selected date', () => {
        const { fixture, service } = setup();
        service.analyses.set([analysis]);
        service.loading.set(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.sa__item')).toBeNull();
        service.loading.set(false);
        service.error.set('Could not load saved analyses.');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.sa__item')).toBeNull();
        fixture.nativeElement.querySelector('.sa__retry').click();
        expect(service.listAnalyses).toHaveBeenLastCalledWith('2026-09-18');
        expect(service.listAnalyses).toHaveBeenCalledTimes(2);
    });

    it('renders saved content on demand and resets expansion when the day changes', async () => {
        const { fixture, service } = setup();
        service.analyses.set([analysis]);
        fixture.detectChanges();
        fixture.nativeElement.querySelector('.sa__item-toggle').click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('.sa__item-body').textContent).toContain('A patient session.');
        fixture.componentRef.setInput('date', '2026-09-19');
        fixture.detectChanges();
        expect(fixture.componentInstance.expandedId()).toBeNull();
        expect(service.listAnalyses).toHaveBeenLastCalledWith('2026-09-19');
    });

    it('shows failed deletions without discarding the saved content', async () => {
        const { fixture, service } = setup();
        service.analyses.set([analysis]);
        service.deleteAnalysis.mockRejectedValueOnce(new Error('offline'));
        await fixture.componentInstance.remove(analysis.id, new Event('click'));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not delete');
        expect(service.analyses()).toEqual([analysis]);
        expect(fixture.componentInstance.deletingId()).toBeNull();
    });

    it('prevents overlapping deletes and ignores errors after navigating to another date', async () => {
        const { fixture, service } = setup();
        let reject!: (error: Error) => void;
        service.deleteAnalysis.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
        const pending = fixture.componentInstance.remove(analysis.id, new Event('click'));
        await fixture.componentInstance.remove('another-id', new Event('click'));
        expect(service.deleteAnalysis).toHaveBeenCalledOnce();
        fixture.componentRef.setInput('date', '2026-09-19');
        fixture.detectChanges();
        reject(new Error('offline'));
        await pending;
        expect(fixture.componentInstance.deleteError()).toBeNull();
    });
});
