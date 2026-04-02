import { Component, inject, signal, OnInit, HostListener, ElementRef } from '@angular/core';
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
    private elRef = inject(ElementRef);

    dropdownOpen = signal(false);

    ngOnInit(): void {
        this.accountService.init();
    }

    toggleDropdown(): void {
        this.dropdownOpen.update(v => !v);
    }

    closeDropdown(): void {
        this.dropdownOpen.set(false);
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (this.dropdownOpen() && !this.elRef.nativeElement.contains(event.target)) {
            this.dropdownOpen.set(false);
        }
    }
}
