import { Component, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TradeTableComponent } from '../../../shared/components/trade-table/trade-table.component';
import { QuillModule } from 'ngx-quill';
import { JournalFormState } from './state/journal-form.state';
import { JournalNewsState } from './state/journal-news.state';
import { JournalRulesState } from './state/journal-rules.state';
import { JournalTemplatesState } from './state/journal-templates.state';
import { JournalTagsState } from './state/journal-tags.state';
import { QUILL_FULL_MODULES, QUILL_COMPACT_MODULES } from './utils/quill-modules';
import { DaySummaryComponent } from './components/day-summary/day-summary.component';

@Component({
    selector: 'app-daily-journal',
    standalone: true,
    imports: [DatePipe, CurrencyPipe, FormsModule, QuillModule, TradeTableComponent, DaySummaryComponent],
    providers: [JournalFormState, JournalNewsState, JournalRulesState, JournalTemplatesState, JournalTagsState],
    templateUrl: './daily-journal.component.html',
    styleUrl: './daily-journal.component.scss'
})
export class DailyJournalComponent {
    form      = inject(JournalFormState);
    news      = inject(JournalNewsState);
    rules     = inject(JournalRulesState);
    templates = inject(JournalTemplatesState);
    tagsState = inject(JournalTagsState);

    readonly TRADES_PAGE_SIZE = 5;
    quillModules = QUILL_FULL_MODULES;
    quillCompactModules = QUILL_COMPACT_MODULES;
}
