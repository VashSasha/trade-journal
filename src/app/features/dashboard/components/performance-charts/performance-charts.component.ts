import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, inject, effect } from '@angular/core';

import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { TradeStats } from '../../../../core/models/trade.model';
import { ThemeService } from '../../../../core/services/theme.service';
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

    private theme = inject(ThemeService);
    private winLossChart?: Chart;

    private get winColor(): string {
        return this.theme.isDark() ? '#059669' : '#059669';
    }

    constructor() {
        effect(() => {
            this.theme.isDark(); // track
            if (this.winLossChart) {
                (this.winLossChart.data.datasets[0] as any).backgroundColor[0] = this.winColor;
                this.winLossChart.update();
            }
        });
    }

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
                    backgroundColor: [this.winColor, this.theme.isDark() ? '#8B2635' : '#e35868'],
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
