import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, inject } from '@angular/core';

import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { TradeStats } from '../../../../core/models/trade.model';
import { AccountSettingsService } from '../../../../core/services/account-settings.service';
import { EquityCurveChartComponent } from '../../../../shared/components/equity-curve-chart/equity-curve-chart.component';

Chart.register(...registerables);

@Component({
    selector: 'app-performance-charts',
    standalone: true,
    imports: [EquityCurveChartComponent],
    templateUrl: './performance-charts.component.html'
})
export class PerformanceChartsComponent implements AfterViewInit, OnDestroy, OnChanges {
    @Input({ required: true }) equityData!: { labels: string[], values: number[] };
    @Input({ required: true }) winLossStats!: TradeStats;

    @ViewChild('winLossChart') winLossChartRef!: ElementRef<HTMLCanvasElement>;

    readonly accountSettings = inject(AccountSettingsService);
    private winLossChart?: Chart;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['winLossStats'] && this.winLossChart && !changes['winLossStats'].firstChange) {
            this.updateWinLossChart();
        }
    }

    ngAfterViewInit(): void {
        setTimeout(() => this.createWinLossChart(), 100);
    }

    ngOnDestroy(): void {
        this.winLossChart?.destroy();
    }

    private createWinLossChart(): void {
        if (!this.winLossChartRef) return;

        const config: ChartConfiguration = {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [this.winLossStats.winningTrades, this.winLossStats.losingTrades],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        };

        this.winLossChart = new Chart(this.winLossChartRef.nativeElement, config);
    }

    private updateWinLossChart(): void {
        if (!this.winLossChart) return;
        this.winLossChart.data.datasets[0].data = [
            this.winLossStats.winningTrades,
            this.winLossStats.losingTrades
        ];
        this.winLossChart.update();
    }
}
