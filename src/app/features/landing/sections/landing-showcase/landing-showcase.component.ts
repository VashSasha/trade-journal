import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

interface CalendarCell {
    /** '' = flat/no-trade day */
    kind: 'pos' | 'neg' | 'flat';
    /** 0..1 intensity */
    intensity: number;
    label?: string;
}

@Component({
    selector: 'app-landing-showcase',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-showcase.component.html',
    styleUrl: './landing-showcase.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingShowcaseComponent {
    readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    /** Static, hand-tuned month so the mockup always looks good. */
    readonly calendarCells: CalendarCell[] = [
        { kind: 'pos', intensity: 0.5, label: '+$320' },
        { kind: 'pos', intensity: 0.8, label: '+$780' },
        { kind: 'neg', intensity: 0.4, label: '−$150' },
        { kind: 'pos', intensity: 0.3, label: '+$90' },
        { kind: 'flat', intensity: 0 },

        { kind: 'pos', intensity: 0.9, label: '+$1.2K' },
        { kind: 'pos', intensity: 0.4, label: '+$210' },
        { kind: 'pos', intensity: 0.6, label: '+$450' },
        { kind: 'neg', intensity: 0.7, label: '−$520' },
        { kind: 'pos', intensity: 0.5, label: '+$340' },

        { kind: 'neg', intensity: 0.3, label: '−$80' },
        { kind: 'pos', intensity: 0.7, label: '+$610' },
        { kind: 'flat', intensity: 0 },
        { kind: 'pos', intensity: 1, label: '+$1.8K' },
        { kind: 'pos', intensity: 0.4, label: '+$260' },

        { kind: 'pos', intensity: 0.6, label: '+$490' },
        { kind: 'neg', intensity: 0.5, label: '−$310' },
        { kind: 'pos', intensity: 0.8, label: '+$840' },
        { kind: 'pos', intensity: 0.3, label: '+$120' },
        { kind: 'pos', intensity: 0.7, label: '+$570' }
    ];
}
