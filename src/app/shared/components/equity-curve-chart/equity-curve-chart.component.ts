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
import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler } from 'chart.js';
import { ThemeService } from '../../../core/services/theme.service';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler);

export interface EquityData {
  labels: string[];
  values: number[];
}

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
  private chart?: Chart;
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

    this.chart = new Chart(this.chartRef.nativeElement, {
      type: 'line',
      data: this.buildData(),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {display: false},
          tooltip: {enabled: false}
        },
        events: [],
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
    });
  }

  private buildData() {
    const {labels, values} = this.equityData;
    const baseline = this.baseline;

    return {
      labels,
      datasets: [
        {
          data: values,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 0,
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
