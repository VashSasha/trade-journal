import { Component, Input } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Trade } from '../../../../core/models/trade.model';

@Component({
    selector: 'app-recent-trades',
    standalone: true,
    imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink],
    templateUrl: './recent-trades.component.html'
})
export class RecentTradesComponent {
    @Input({ required: true }) trades: Trade[] = [];
}
