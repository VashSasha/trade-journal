import { Component, inject, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AccountService } from '../../../../core/services/account.service';

@Component({
    selector: 'app-account-selector',
    standalone: true,
    imports: [CurrencyPipe],
    templateUrl: './account-selector.component.html',
    styleUrl: './account-selector.component.scss'
})
export class AccountSelectorComponent implements OnInit {
    accountService = inject(AccountService);
    dropdownOpen = false;

    ngOnInit(): void {
        this.accountService.init();
    }

    toggleDropdown(): void {
        this.dropdownOpen = !this.dropdownOpen;
    }

    closeDropdown(): void {
        this.dropdownOpen = false;
    }
}
