import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JournalRulesState } from '../../state/journal-rules.state';
import { JournalFormState } from '../../state/journal-form.state';

@Component({
    selector: 'app-dj-rules',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './dj-rules.component.html',
    styleUrl: './dj-rules.component.scss'
})
export class DjRulesComponent {
    rules = inject(JournalRulesState);
    form  = inject(JournalFormState);
}
