import { Component, inject, OnInit, signal } from '@angular/core';
import { ReportAnalysisService } from '../report-analysis.service';
import { VerdictCardComponent } from '../verdict-card/verdict-card.component';

@Component({
    selector: 'app-saved-reports',
    standalone: true,
    imports: [VerdictCardComponent],
    templateUrl: './saved-reports.component.html',
    styleUrl: './saved-reports.component.scss'
})
export class SavedReportsComponent implements OnInit {
    readonly reportService = inject(ReportAnalysisService);

    expandedId = signal<string | null>(null);
    deletingId = signal<string | null>(null);

    ngOnInit(): void {
        void this.reportService.listReports();
    }

    toggle(id: string): void {
        this.expandedId.update(current => current === id ? null : id);
    }

    async deleteReport(id: string): Promise<void> {
        this.deletingId.set(id);
        try {
            await this.reportService.deleteReport(id);
            if (this.expandedId() === id) this.expandedId.set(null);
        } catch {
            // silent — row stays in list; user can retry
        } finally {
            this.deletingId.set(null);
        }
    }

    relativeTime(isoString: string): string {
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}
