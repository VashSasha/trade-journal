import { Component, computed, input, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { Trade } from '../../../../core/models/trade.model';
import {
    AnalyticsUnit,
    analyticsUnitLabel,
    buildAnalyticsObservations,
} from '../../utils/analytics-performance.utils';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

interface SymbolStat {
    symbol: string;
    pnl: number;
    winRate: number;
    count: number;
}

@Component({
    selector: 'app-performance-by-symbol',
    standalone: true,
    imports: [],
    template: `
        <div class="chart-wrap">
            <canvas #chartCanvas></canvas>
            @if (chartData().length === 0) {
                <div class="chart-empty">No closed trades to display</div>
            }
        </div>
    `,
    styleUrl: './performance-by-symbol.component.scss'
})
export class PerformanceBySymbolComponent implements AfterViewInit, OnDestroy {
    readonly trades = input.required<Trade[]>();
    readonly unit = input<AnalyticsUnit>('decision');

    @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
    private chart: Chart<'bar'> | undefined;

    chartData = computed((): SymbolStat[] => {
        const map = new Map<string, { pnl: number; wins: number; total: number }>();

        buildAnalyticsObservations(this.trades(), this.unit())
            .forEach(observation => {
                const s = map.get(observation.symbol) ?? { pnl: 0, wins: 0, total: 0 };
                s.pnl += observation.pnl;
                s.total++;
                if (observation.pnl > 0) s.wins++;
                map.set(observation.symbol, s);
            });

        return Array.from(map.entries())
            .map(([symbol, d]) => ({
                symbol,
                pnl: d.pnl,
                winRate: d.total > 0 ? Math.round(d.wins / d.total * 100) : 0,
                count: d.total
            }))
            .sort((a, b) => b.pnl - a.pnl);
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

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4 } as any] },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const d = this.chartData()[ctx.dataIndex];
                                const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
                                const unit = analyticsUnitLabel(this.unit());
                                const label = unit.charAt(0).toUpperCase() + unit.slice(1);
                                return [`P&L: ${fmt.format(ctx.parsed.x ?? 0)}`, `Win Rate: ${d?.winRate ?? 0}%`, `${label}: ${d?.count ?? 0}`];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148,163,184,0.1)' },
                        ticks: { callback: v => `$${Number(v).toLocaleString()}`, color: '#94a3b8', font: { size: 11 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 12 } }
                    }
                }
            }
        });
        this.updateChart(this.chartData());
    }

    private updateChart(data: SymbolStat[]): void {
        if (!this.chart) return;
        this.chart.data.labels = data.map(d => d.symbol);
        this.chart.data.datasets[0].data = data.map(d => d.pnl);
        (this.chart.data.datasets[0] as any).backgroundColor = data.map(d =>
            d.pnl >= 0 ? 'rgba(16,185,129,0.6)' : 'rgba(139,38,53,0.65)'
        );
        this.chart.update();
    }
}
