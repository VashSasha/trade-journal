import { Component, inject, HostListener, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JournalNewsState } from '../../state/journal-news.state';
import { JournalFormState } from '../../state/journal-form.state';

@Component({
    selector: 'app-dj-news',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './dj-news.component.html',
    styleUrl: './dj-news.component.scss'
})
export class DjNewsComponent {
    news = inject(JournalNewsState);
    form = inject(JournalFormState);
    private elRef = inject(ElementRef);

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (this.news.showNewsDropdown() && !this.elRef.nativeElement.contains(event.target)) {
            this.news.showNewsDropdown.set(false);
        }
    }
}
