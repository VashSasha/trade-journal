import { Component, computed, input, effect, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration } from 'chart.js/auto';
import { Trade } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-hourly-performance',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="relative h-64 w-full">
            <canvas #chartCanvas></canvas>
        </div>
    `
})
export class HourlyPerformanceComponent implements AfterViewInit {
    trades = input.required<Trade[]>();

    @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
    private chart: Chart | undefined;

    // Computed data for the chart
    chartData = computed(() => {
        const trades = this.trades();

        // Initialize hours 0-23
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const data = hours.map(hour => ({
            hour,
            pnl: 0,
            wins: 0,
            total: 0
        }));

        trades.forEach(t => {
            const date = new Date(t.entryDate);
            const hour = date.getHours();

            // Only count closed trades for PnL/Win Rate
            if (t.status === 'closed' && t.netPnl !== undefined) {
                data[hour].pnl += t.netPnl;
                data[hour].total++;
                if (t.netPnl > 0) data[hour].wins++;
            }
        });

        // Filter out empty hours to keep chart clean? Or keep all?
        // Let's keep hours that have trading activity (9AM - 4PM usually, but crypto is 24/7)
        // For now, let's just return the raw data and filters in labels
        return data;
    });

    constructor() {
        // Update chart when data changes
        effect(() => {
            const data = this.chartData();
            if (this.chart) {
                this.updateChart(data);
            }
        });
    }

    ngAfterViewInit() {
        this.initChart();
    }

    private initChart() {
        const ctx = this.chartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        type: 'line',
                        label: 'Win Rate %',
                        data: [],
                        borderColor: '#10b981', // Emerald 500
                        borderWidth: 2,
                        yAxisID: 'y1',
                        tension: 0.4
                    },
                    {
                        type: 'bar',
                        label: 'Net PnL',
                        data: [],
                        backgroundColor: (context) => {
                            const value = context.raw as number;
                            return value >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)';
                        },
                        yAxisID: 'y',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.datasetIndex === 0) { // Win Rate
                                    label += context.parsed.y + '%';
                                } else { // PnL
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y || 0);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Net PnL ($)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: 0,
                        max: 100,
                        grid: {
                            drawOnChartArea: false, // only want the grid lines for one axis to show up
                        },
                        title: { display: true, text: 'Win Rate (%)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        };

        this.chart = new Chart(ctx, config);
        this.updateChart(this.chartData());
    }

    private updateChart(data: any[]) {
        if (!this.chart) return;

        // Filter to only show hours with activity or a specific range (e.g. 8AM to 5PM if only stocks)
        // For now, let's show all hours that have at least one trade
        const activeHours = data.filter(d => d.total > 0);

        // If empty, show nothing
        if (activeHours.length === 0) {
            this.chart.data.labels = [];
            this.chart.data.datasets[0].data = [];
            this.chart.data.datasets[1].data = [];
            this.chart.update();
            return;
        }

        this.chart.data.labels = activeHours.map(d => `${d.hour}:00`);

        // Win Rate
        this.chart.data.datasets[0].data = activeHours.map(d =>
            d.total > 0 ? Math.round((d.wins / d.total) * 100) : 0
        );

        // PnL
        this.chart.data.datasets[1].data = activeHours.map(d => d.pnl);

        this.chart.update();
    }
}
