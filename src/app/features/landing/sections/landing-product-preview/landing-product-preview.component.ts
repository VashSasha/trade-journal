import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { EquityCurveChartComponent, EquityData } from '../../../../shared/components/equity-curve-chart/equity-curve-chart.component';

type PreviewView = 'coach' | 'review' | 'analytics';

/** Public, illustrative data only. Never loads a session, trades, audio or an AI request. */
@Component({
    selector: 'app-landing-product-preview',
    standalone: true,
    imports: [EquityCurveChartComponent],
    templateUrl: './landing-product-preview.component.html',
    styleUrl: './landing-product-preview.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingProductPreviewComponent {
    readonly view = signal<PreviewView>('coach');
    readonly moment = signal<'target' | 'pace'>('target');
    readonly views: { id: PreviewView; label: string }[] = [
        { id: 'coach', label: 'Live Coach' }, { id: 'review', label: 'Daily review' }, { id: 'analytics', label: 'Analytics' },
    ];
    readonly equity: EquityData = {
        labels: ['9:30', '9:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'],
        values: [75000, 75060, 74960, 75030, 75190, 75150, 75210, 75200, 75260],
    };
    readonly waveform = [12, 20, 10, 28, 36, 18, 30, 42, 24, 14, 34, 22, 38, 16, 28, 12, 24, 10];
    readonly coachText = computed(() => this.moment() === 'target'
        ? 'Your selected accounts are at +$340: $260 realized and $80 still open. You’ve reached your $300 daily target. Open P&L can change — check your plan before the next trade.'
        : 'You’ve completed 12 trades across 3 accounts. Copied trades can increase that total; review the account breakdown before judging your pace.');
    selectView(view: PreviewView): void { this.view.set(view); }
}
