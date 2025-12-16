import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TradeService } from '../../../core/services/trade.service';
import { Trade } from '../../../core/models/trade.model';

@Component({
  selector: 'app-trade-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './trade-detail.html',
  styleUrl: './trade-detail.scss'
})
export class TradeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tradeService = inject(TradeService);

  trade = signal<Trade | undefined>(undefined);

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        const foundTrade = this.tradeService.getTradeById(id);
        if (foundTrade) {
          this.trade.set(foundTrade);
        } else {
          // Trade not found, go back to journal
          this.router.navigate(['/journal']);
        }
      }
    });
  }

  deleteTrade(): void {
    const t = this.trade();
    if (!t) return;

    // Use confirm dialog for now (unless we want to implement custom modal later)
    this.tradeService.deleteTrade(t.id);
    this.router.navigate(['/journal']);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}
