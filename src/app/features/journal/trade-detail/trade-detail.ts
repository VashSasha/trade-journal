import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TradeService } from '../../../core/services/trade.service';
import { Trade } from '../../../core/models/trade.model';

@Component({
  selector: 'app-trade-detail',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink],
  templateUrl: './trade-detail.html',
  styleUrl: './trade-detail.scss'
})
export class TradeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tradeService = inject(TradeService);
  private destroyRef = inject(DestroyRef);

  trade = signal<Trade | undefined>(undefined);

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
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

  calculatePoints(trade: Trade): string {
    if (!trade.entryPrice || !trade.exitPrice) return '0.00';

    const points = trade.direction === 'long'
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;

    return (points >= 0 ? '+' : '') + points.toFixed(2);
  }
}
