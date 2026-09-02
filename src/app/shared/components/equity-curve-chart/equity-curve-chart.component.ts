import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  effect,
  inject
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip
} from 'chart.js';
import { ThemeService } from '../../../core/services/theme.service';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip);

export interface EquityData {
  labels: string[];
  values: number[];
}

/** Point shape for the curve — numeric, with nulls tolerated for gaps. */
type EquityPoint = number | null;

@Component({
  selector: 'app-equity-curve-chart',
  standalone: true,
  imports: [],
  template: `
    <canvas #chartCanvas></canvas>`,
  styles: [`:host {
    display: block;
    height: 100%;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }`]
})
export class EquityCurveChartComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input({required: true}) equityData!: EquityData;
  /** Y value where the fill splits green/red and the dashed line is drawn */
  @Input() baseline = 0;

  @ViewChild('chartCanvas') chartRef!: ElementRef<HTMLCanvasElement>;
  /**
   * Generics are pinned to what this component actually builds — a line chart
   * with numeric points and string labels. Leaving it as a bare `Chart` fails
   * to compile: the typed tooltip callbacks narrow the inferred instance to
   * `Chart<'line', …>`, which isn't assignable to the wider default.
   */
  private chart?: Chart<'line', EquityPoint[], string>;
  private theme = inject(ThemeService);

  constructor() {
    effect(() => {
      this.theme.isDark(); // track theme changes
      if (this.chart) {
        this.chart.destroy();
        this.chart = undefined;
        setTimeout(() => this.createChart(), 0);
      }
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.createChart(), 50);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['equityData'] || changes['baseline']) && !changes['equityData']?.firstChange) {
      this.chart?.destroy();
      this.chart = undefined;

      setTimeout(() => this.createChart(), 0);
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private createChart(): void {
    if (!this.chartRef) return;
    this.chart?.destroy();
    this.chart = undefined;

    const isDark = this.theme.isDark();

    const config: ChartConfiguration<'line', EquityPoint[], string> = {
      type: 'line',
      data: this.buildData(),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {display: false},
          tooltip: {
            enabled: true,
            filter: (item) => item.datasetIndex === 0,
            backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
            titleColor: isDark ? '#e2e8f0' : '#1e293b',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.3)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (item) => {
                return ` Balance: ${this.formatCurrency(item.parsed.y ?? 0)}`;
              },
              afterLabel: (item) => {
                const data = item.chart.data.datasets[0].data as (number | null)[];
                const firstVal = data[0] ?? 0;
                const change = (item.parsed.y ?? 0) - firstVal;
                const sign = change >= 0 ? '+' : '';
                return ` ${sign}${this.formatCurrency(change)} since open`;
              }
            }
          }
        },
        scales: {
          x: {display: false},
          y: {
            display: true,
            grid: {color: 'rgba(148,163,184,0.12)'},
            ticks: {
              color: '#94a3b8',
              font: {size: 11},
              callback: v => `$${Number(v).toLocaleString()}`
            }
          }
        }
      }
    };

    this.chart = new Chart(this.chartRef.nativeElement, config);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private buildData() {
    const {labels, values} = this.equityData;
    const baseline = this.baseline;
    const isDark = this.theme.isDark();

    const pointColors = values.map(v =>
      v >= baseline
        ? (isDark ? '#10b981' : '#059669')
        : (isDark ? '#6B1F2A' : '#8B2635')
    );

    return {
      labels,
      datasets: [
        {
          data: values,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: pointColors,
          pointHoverBorderColor: isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.9)',
          pointHitRadius: 8,
          // Color each segment based on whether it sits above or below baseline
          segment: {
            borderColor: (ctx: any) => {
              const mid = (ctx.p0.parsed.y + ctx.p1.parsed.y) / 2;
              return mid >= baseline
                ? (this.theme.isDark() ? '#10b981' : '#059669')
                : (this.theme.isDark() ? '#6B1F2A' : '#8B2635');
            }
          },
          fill: {
            target: {value: baseline},
            above: this.theme.isDark() ? 'rgba(16,185,129,0.25)' : 'rgba(16,185,129,0.20)',
            below: this.theme.isDark() ? 'rgba(107,31,42,0.40)' : 'rgba(139,38,53,0.25)'
          }
        },
        {
          data: labels.map(() => baseline),
          borderColor: 'rgba(148,163,184,0.6)',
          borderWidth: 1,
          borderDash: [5, 4],
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0
        }
      ] as any[]
    };
  }



}
