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

    relativeTime(iso: string | null): string {
        if (!iso) return '';
        const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
        if (m < 2) return 'just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }
}
