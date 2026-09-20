import { afterNextRender, Component, computed, inject, Injector, signal, OnInit, HostListener, ElementRef, viewChild } from '@angular/core';
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
    private readonly injector = inject(Injector);
    private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
    private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

    dropdownOpen = signal(false);
    readonly selectionLabel = computed(() => {
        const ids = this.accountService.selectedIds();
        if (!ids.length) return 'Select accounts';
        if (ids.length > 1) return `${ids.length} accounts selected`;
        return [...this.accountService.accounts(), ...this.accountService.historicalAccounts()]
            .find(account => account.id === ids[0])?.name || 'Account balance';
    });

    ngOnInit(): void {
        this.accountService.init();
    }

    toggleDropdown(): void {
        if (this.dropdownOpen()) { this.closeDropdown(); return; }
        this.dropdownOpen.set(true);
        afterNextRender(() => {
            if (this.dropdownOpen()) this.closeButton()?.nativeElement.focus();
        }, { injector: this.injector });
    }

    closeDropdown(restoreFocus = true): void {
        this.dropdownOpen.set(false);
        if (restoreFocus) this.trigger()?.nativeElement.focus();
    }

    @HostListener('keydown.escape', ['$event'])
    onEscape(event: Event): void {
        if (!this.dropdownOpen()) return;
        event.stopPropagation();
        this.closeDropdown();
    }

    @HostListener('focusout', ['$event'])
    onFocusOut(event: FocusEvent): void {
        if (this.dropdownOpen() && event.relatedTarget && !this.elRef.nativeElement.contains(event.relatedTarget)) {
            this.closeDropdown(false);
        }
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (this.dropdownOpen() && !this.elRef.nativeElement.contains(event.target)) {
            this.closeDropdown(false);
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
