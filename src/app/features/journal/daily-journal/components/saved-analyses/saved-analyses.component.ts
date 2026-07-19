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

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['date'] && this.date) {
            void this.service.listAnalyses(this.date);
        }
    }

    toggle(id: string): void {
        this.expandedId.update(cur => (cur === id ? null : id));
    }

    async remove(id: string, event: Event): Promise<void> {
        event.stopPropagation();
        this.deletingId.set(id);
        try {
            await this.service.deleteAnalysis(id);
            if (this.expandedId() === id) this.expandedId.set(null);
        } finally {
            this.deletingId.set(null);
        }
    }
}
