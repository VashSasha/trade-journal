import { Component, Input, ViewChild, ElementRef, AfterViewInit, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { TradeStats } from '../../../../core/models/trade.model';

Chart.register(...registerables);

@Component({
    selector: 'app-performance-charts',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './performance-charts.component.html'
})
export class PerformanceChartsComponent implements AfterViewInit, OnDestroy {
    @Input({ required: true }) equityData!: { labels: string[], values: number[] };
    @Input({ required: true }) winLossStats!: TradeStats;

    @ViewChild('equityChart') equityChartRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('winLossChart') winLossChartRef!: ElementRef<HTMLCanvasElement>;

    private equityChart?: Chart;
    private winLossChart?: Chart;

    constructor() {
        // Re-render when inputs change
        effect(() => {
            if (this.equityChart && this.equityData) {
                this.updateEquityChart();
            }
            if (this.winLossChart && this.winLossStats) {
                this.updateWinLossChart();
            }
        });
    }

    ngAfterViewInit(): void {
        setTimeout(() => {
            this.createEquityChart();
            this.createWinLossChart();
        }, 100);
    }

    ngOnDestroy(): void {
        if (this.equityChart) this.equityChart.destroy();
        if (this.winLossChart) this.winLossChart.destroy();
    }

    private createEquityChart(): void {
        if (!this.equityChartRef) return;

        const config: ChartConfiguration = {
            type: 'line',
            data: {
                labels: this.equityData.labels,
                datasets: [{
                    label: 'Cumulative P&L',
                    data: this.equityData.values,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `P&L: $${(context.parsed.y || 0).toFixed(2)}`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (value) => `$${value}`
                        }
                    }
                }
            }
        };

        this.equityChart = new Chart(this.equityChartRef.nativeElement, config);
    }

    private updateEquityChart(): void {
        if (!this.equityChart) return;
        this.equityChart.data.labels = this.equityData.labels;
        this.equityChart.data.datasets[0].data = this.equityData.values;
        this.equityChart.update();
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
