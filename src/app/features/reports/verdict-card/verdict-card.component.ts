import { Component, Input, signal } from '@angular/core';
import { VerdictCard } from '../verdict-card.model';

@Component({
    selector: 'app-verdict-card',
    standalone: true,
    imports: [],
    templateUrl: './verdict-card.component.html',
    styleUrl: './verdict-card.component.scss',
    host: { '[class.air-vc--compact]': 'compact' }
})
export class VerdictCardComponent {
    @Input({ required: true }) verdict!: VerdictCard;

    /** When true, strips the card border/background so it embeds cleanly in a list item. */
    @Input() compact = false;

    contingencyExpanded = signal(false);
}
