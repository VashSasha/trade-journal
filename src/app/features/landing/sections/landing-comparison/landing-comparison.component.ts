import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RevealOnScrollDirective } from '../../reveal-on-scroll.directive';

type Mark = 'yes' | 'no' | 'partial';

interface CompareRow {
    label: string;
    spreadsheet: Mark | string;
    generic: Mark | string;
    nvzn: Mark | string;
    star?: boolean;
}

@Component({
    selector: 'app-landing-comparison',
    standalone: true,
    imports: [RevealOnScrollDirective],
    templateUrl: './landing-comparison.component.html',
    styleUrl: './landing-comparison.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComparisonComponent {
    readonly rows: CompareRow[] = [
        {
            label: 'Broker auto-sync',
            spreadsheet: 'no',
            generic: 'partial',
            nvzn: 'yes'
        },
        {
            label: 'FIFO matching with real fees',
            spreadsheet: 'no',
            generic: 'partial',
            nvzn: 'yes'
        },
        {
            label: 'Built-in AI coach reviewing YOUR trades',
            spreadsheet: 'no',
            generic: 'no',
            nvzn: 'yes',
            star: true
        },
        {
            label: 'Included with NVZN Trading membership',
            spreadsheet: 'no',
            generic: 'no',
            nvzn: 'yes'
        },
        {
            label: 'Price',
            spreadsheet: 'Free — paid in hours',
            generic: 'Separate subscription',
            nvzn: 'Included with membership · journal-only plan available'
        }
    ];

    isMark(value: Mark | string): value is Mark {
        return value === 'yes' || value === 'no' || value === 'partial';
    }
}
