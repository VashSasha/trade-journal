import { Component, computed, input, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Chart, ChartConfiguration } from 'chart.js/auto';
import { Trade } from '../../../../core/models/trade.model';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DayStat {
    day: number;
    avgPnl: number;
    winRate: number;
    total: number;
}

@Component({
    selector: 'app-performance-by-weekday',
    standalone: true,
    imports: [],
    template: `
        <div class="chart-wrap">
            <canvas #chartCanvas></canvas>
            @if (hasNoData()) {
                <div class="chart-empty">No closed trades to display</div>
            }
        </div>
    `,
    styleUrl: './performance-by-weekday.component.scss'
})
export class PerformanceByWeekdayComponent implements AfterViewInit, OnDestroy {
    trades = input.required<Trade[]>();

    @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
    private chart: Chart | undefined;

    hasNoData = computed(() => this.chartData().every(d => d.total === 0));

    chartData = computed((): DayStat[] => {
        const days = Array.from({ length: 7 }, (_, i) => ({
            day: i, avgPnl: 0, winRate: 0, total: 0, wins: 0, totalPnl: 0
        }));

        this.trades()
            .filter(t => t.status === 'closed')
            .forEach(t => {
                const dow = new Date(t.entryDate).getDay();
                days[dow].total++;
                days[dow].totalPnl += (t.netPnl ?? 0);
                if ((t.netPnl ?? 0) > 0) days[dow].wins++;
            });

        return days.slice(1, 6).map(d => ({
            day: d.day,
            avgPnl: d.total > 0 ? d.totalPnl / d.total : 0,
            winRate: d.total > 0 ? Math.round(d.wins / d.total * 100) : 0,
            total: d.total
        }));
    });

    constructor() {
        effect(() => {
            const data = this.chartData();
            if (this.chart) this.updateChart(data);
        });
    }

    ngAfterViewInit(): void {
        this.initChart();
    }

    ngOnDestroy(): void {
        this.chart?.destroy();
    }

    private initChart(): void {
        const ctx = this.chartCanvas?.nativeElement.getContext('2d');
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
                        borderColor: '#10b981',
                        borderWidth: 2,
                        yAxisID: 'y1',
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981'
                    } as any,
                    {
                        type: 'bar',
                        label: 'Avg P&L',
                        data: [],
                        backgroundColor: [],
                        yAxisID: 'y',
                        borderRadius: 6
                    } as any
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
                                const y = ctx.parsed.y ?? 0;
                                return ctx.datasetIndex === 0
                                    ? `Win Rate: ${y}%`
                                    : `Avg P&L: ${fmt.format(y)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: 'rgba(148,163,184,0.1)' },
                        ticks: { callback: v => `$${Number(v).toLocaleString()}`, color: '#94a3b8', font: { size: 11 } }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        min: 0, max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { callback: v => `${v}%`, color: '#94a3b8', font: { size: 11 } }
                    },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        };

        this.chart = new Chart(ctx, config);
        this.updateChart(this.chartData());
    }

    private updateChart(data: DayStat[]): void {
        if (!this.chart) return;
        this.chart.data.labels = data.map(d => DAY_NAMES[d.day]);
        this.chart.data.datasets[0].data = data.map(d => d.winRate);
        this.chart.data.datasets[1].data = data.map(d => d.avgPnl);
        (this.chart.data.datasets[1] as any).backgroundColor = data.map(d =>
            d.avgPnl >= 0 ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'
        );
        this.chart.update();
    }
}
