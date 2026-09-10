import { CurrencyPipe, DecimalPipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    OnDestroy,
    ViewChild,
} from '@angular/core';
import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    ChartConfiguration,
    LinearScale,
    Tooltip,
} from 'chart.js';
import { ThemeService } from '../../../../core/services/theme.service';
import {
    AnalyticsObservation,
    AnalyticsUnit,
    analyticsUnitLabel,
} from '../../utils/analytics-performance.utils';
import { buildPnlDistribution, PnlDistribution } from './pnl-distribution.utils';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

interface ChartColors {
    border: string;
    loss: string;
    muted: string;
    profit: string;
    surface: string;
    text: string;
}

@Component({
    selector: 'app-pnl-distribution',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe],
    templateUrl: './pnl-distribution.component.html',
    styleUrl: './pnl-distribution.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PnlDistributionComponent implements AfterViewInit, OnDestroy {
    readonly observations = input.required<readonly AnalyticsObservation[]>();
    readonly unit = input<AnalyticsUnit>('decision');

    @ViewChild('chartCanvas') private chartCanvas?: ElementRef<HTMLCanvasElement>;

    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly theme = inject(ThemeService);
    private chart?: Chart<'bar', number[], string>;
    private updateFrame: number | null = null;

    readonly distribution = computed(() =>
        buildPnlDistribution(this.observations().map(observation => observation.pnl)),
    );
    readonly unitLabel = computed(() => analyticsUnitLabel(this.unit()));
    readonly chartLabel = computed(() =>
        `P&L distribution for ${this.distribution().count} ${this.unitLabel()}`,
    );
    readonly takeaway = computed(() => this.describeDistribution(this.distribution()));

    constructor() {
        effect(() => {
            const distribution = this.distribution();
            this.theme.isDark();
            if (this.chart) this.scheduleChartUpdate(distribution);
        });
    }

    ngAfterViewInit(): void {
        this.initializeChart();
    }

    ngOnDestroy(): void {
        if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame);
        this.chart?.destroy();
    }

    private initializeChart(): void {
        const context = this.chartCanvas?.nativeElement.getContext('2d');
        if (!context) return;
        const colors = this.readColors();
        const config: ChartConfiguration<'bar', number[], string> = {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [],
                    borderWidth: 0,
                    borderRadius: 4,
                    barPercentage: 0.94,
                    categoryPercentage: 0.96,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 240 },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderWidth: 1,
                        titleColor: colors.text,
                        bodyColor: colors.muted,
                        displayColors: false,
                        callbacks: {
                            title: items => {
                                const bin = this.distribution().bins[items[0]?.dataIndex ?? -1];
                                return bin ? this.formatRange(bin.lower, bin.upper) : '';
                            },
                            label: context => {
                                const count = context.parsed.y ?? 0;
                                const total = this.distribution().count;
                                const unit = analyticsUnitLabel(this.unit(), count !== 1);
                                const share = total ? count / total * 100 : 0;
                                return `${count} ${unit} · ${share.toFixed(1)}% of results`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        border: { display: false },
                        grid: { display: false },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            color: colors.muted,
                            font: { size: 10 },
                        },
                    },
                    y: {
                        beginAtZero: true,
                        border: { display: false },
                        grid: { color: colors.border },
                        ticks: {
                            color: colors.muted,
                            precision: 0,
                            font: { size: 10 },
                        },
                        title: {
                            display: true,
                            text: 'Frequency',
                            color: colors.muted,
                            font: { size: 10, weight: 500 },
                        },
                    },
                },
            },
        };

        this.chart = new Chart(context, config);
        this.updateChart(this.distribution());
    }

    private scheduleChartUpdate(distribution: PnlDistribution): void {
        if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame);
        this.updateFrame = requestAnimationFrame(() => {
            this.updateFrame = null;
            this.updateChart(distribution);
        });
    }

    private updateChart(distribution: PnlDistribution): void {
        if (!this.chart) return;
        const colors = this.readColors();
        const visibleBins = distribution.count >= 3 ? distribution.bins : [];
        this.chart.data.labels = visibleBins.map(bin =>
            this.formatCompactCurrency((bin.lower + bin.upper) / 2),
        );
        this.chart.data.datasets[0].data = visibleBins.map(bin => bin.count);
        this.chart.data.datasets[0].backgroundColor = visibleBins.map(bin => {
            if (bin.tone === 'loss') return colors.loss;
            if (bin.tone === 'profit') return colors.profit;
            return colors.muted;
        });

        const x = this.chart.options.scales?.['x'];
        const y = this.chart.options.scales?.['y'];
        if (x?.ticks) x.ticks.color = colors.muted;
        if (y?.ticks) y.ticks.color = colors.muted;
        if (y?.grid) y.grid.color = colors.border;
        if (y?.title) y.title.color = colors.muted;
        const tooltip = this.chart.options.plugins?.tooltip;
        if (tooltip) {
            tooltip.backgroundColor = colors.surface;
            tooltip.borderColor = colors.border;
            tooltip.titleColor = colors.text;
            tooltip.bodyColor = colors.muted;
        }
        this.chart.update();
    }

    private describeDistribution(distribution: PnlDistribution): string {
        const unit = analyticsUnitLabel(this.unit());
        if (distribution.count < 5) {
            return `Add more closed ${unit} before treating this shape as a stable pattern.`;
        }
        if (distribution.winnerCount === 0) {
            return `This selection has no profitable ${unit}; review risk and entry quality before increasing size.`;
        }

        const median = distribution.median ?? 0;
        const mean = distribution.mean ?? 0;
        const concentration = distribution.topWinnerShare ?? 0;
        if (concentration >= 50 && median <= 0 && mean > 0) {
            return 'A small group of winners is carrying a typically flat or losing result.';
        }
        if (concentration >= 50) {
            return 'A small group of winners contributes most of your gross profit.';
        }
        if (median > 0) {
            return 'Your typical outcome is profitable, not only your average result.';
        }
        if (mean > 0) {
            return 'Larger winners overcome a flat or negative typical outcome.';
        }
        if (median < 0) {
            return 'The typical outcome is negative in the current selection.';
        }
        return 'Results cluster around breakeven in the current selection.';
    }

    private readColors(): ChartColors {
        const styles = getComputedStyle(this.host.nativeElement);
        const color = (name: string) => styles.getPropertyValue(name).trim();
        return {
            border: color('--color-border'),
            loss: color('--color-negative'),
            muted: color('--color-text-muted'),
            profit: color('--color-positive'),
            surface: color('--color-bg-surface-3'),
            text: color('--color-text-primary'),
        };
    }

    private formatCompactCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            notation: Math.abs(value) >= 1_000 ? 'compact' : 'standard',
            maximumFractionDigits: 0,
        }).format(value);
    }

    private formatRange(lower: number, upper: number): string {
        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
        });
        return `${formatter.format(lower)} to ${formatter.format(upper)}`;
    }
}
