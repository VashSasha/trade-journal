import { Component, inject, computed, OnInit, AfterViewInit, ViewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TradeService } from '../../core/services/trade.service';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.scss'
})
export class DashboardComponent implements AfterViewInit {
    private tradeService = inject(TradeService);

    @ViewChild('equityChart') equityChartRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('winLossChart') winLossChartRef!: ElementRef<HTMLCanvasElement>;

    private equityChart?: Chart;
    private winLossChart?: Chart;

    // Stats
    stats = this.tradeService.stats;

    // Recent trades (last 5)
    recentTrades = computed(() => {
        return [...this.tradeService.trades()]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5);
    });

    // Equity curve data
    equityCurveData = computed(() => {
        const trades = [...this.tradeService.closedTrades()]
            .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

        let cumulative = 0;
        const data = trades.map(t => {
            cumulative += t.netPnl || 0;
            return {
                date: new Date(t.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                value: cumulative
            };
        });

        return {
            labels: data.map(d => d.date),
            values: data.map(d => d.value)
        };
    });

    ngAfterViewInit(): void {
        // Wait a bit for the view to be fully rendered
        setTimeout(() => {
            this.createEquityChart();
            this.createWinLossChart();
        }, 100);
    }

    private createEquityChart(): void {
        const data = this.equityCurveData();

        const config: ChartConfiguration = {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Cumulative P&L',
                    data: data.values,
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
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return `P&L: $${context.parsed.toFixed(2)}`;
                            }
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

    private createWinLossChart(): void {
        const stats = this.stats();

        const config: ChartConfiguration = {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [stats.winningTrades, stats.losingTrades],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        };

        this.winLossChart = new Chart(this.winLossChartRef.nativeElement, config);
    }

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(value);
    }

    formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
}
