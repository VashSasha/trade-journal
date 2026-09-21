import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MarkdownComponent } from 'ngx-markdown';
import { AiAnalysisService } from './ai-analysis.service';

/**
 * Self-contained widget: lists the saved AI analyses for a given journal date,
 * each collapsible with a delete action. Reloads whenever `date` changes.
 * State comes in via the injected AiAnalysisService, so it can be dropped
 * anywhere the service is provided.
 */
@Component({
    selector: 'app-saved-analyses',
    standalone: true,
    imports: [DatePipe, MarkdownComponent],
    templateUrl: './saved-analyses.component.html',
    styleUrl: './saved-analyses.component.scss'
})
export class SavedAnalysesComponent implements OnChanges {
    @Input({ required: true }) date!: string;

    private service = inject(AiAnalysisService);

    readonly analyses = this.service.analyses;
    readonly loading = this.service.loading;
    readonly error = this.service.error;

    expandedId = signal<string | null>(null);
    deletingId = signal<string | null>(null);
    deleteError = signal<string | null>(null);

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['date'] && this.date) {
            this.expandedId.set(null);
            this.deleteError.set(null);
            this.reload();
        }
    }

    reload(): void {
        void this.service.listAnalyses(this.date);
    }

    toggle(id: string): void {
        this.expandedId.update(cur => (cur === id ? null : id));
    }

    async remove(id: string, event: Event): Promise<void> {
        event.stopPropagation();
        if (this.deletingId()) return;
        const date = this.date;
        this.deletingId.set(id);
        this.deleteError.set(null);
        try {
            await this.service.deleteAnalysis(id);
            if (this.date === date && this.expandedId() === id) this.expandedId.set(null);
        } catch {
            if (this.date === date) this.deleteError.set('Could not delete this analysis. Please try again.');
        } finally {
            this.deletingId.set(null);
        }
    }
}
