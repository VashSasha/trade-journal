import { afterNextRender, Component, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { JournalFormState } from '../../state/journal-form.state';
import { JournalTagsState } from '../../state/journal-tags.state';

/** Date browsing stays mounted when collapsed so the journal draft is untouched. */
@Component({
    selector: 'app-journal-timeline',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './journal-timeline.component.html',
    styleUrl: './journal-timeline.component.scss',
})
export class JournalTimelineComponent {
    readonly form = inject(JournalFormState);
    readonly tags = inject(JournalTagsState);
    readonly open = signal(false);
    readonly filtersOpen = signal(false);
    private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
    private readonly injector = inject(Injector);

    selectDate(date: string): void {
        this.form.selectDate(date);
        if (!this.trigger()?.nativeElement.getClientRects().length) return;
        this.open.set(false);
        afterNextRender(() => this.trigger()?.nativeElement.focus(), { injector: this.injector });
    }
}
