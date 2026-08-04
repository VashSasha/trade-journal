import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ImportTradesState, CUSTOM_ACCOUNT } from './import-trades.state';

/**
 * Settings-page section widget: manual trade import from a Tradovate
 * Performance CSV export. Self-contained — all state lives in the scoped
 * ImportTradesState; drop it on any page and it works.
 */
@Component({
    selector: 'app-import-trades',
    standalone: true,
    imports: [DatePipe],
    providers: [ImportTradesState],
    templateUrl: './import-trades.component.html',
    styleUrl: './import-trades.component.scss'
})
export class ImportTradesComponent {
    state = inject(ImportTradesState);
    readonly CUSTOM_ACCOUNT = CUSTOM_ACCOUNT;

    onAccountChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.state.selectedAccountKey.set(value || null);
    }

    onCustomNameInput(event: Event): void {
        this.state.customAccountName.set((event.target as HTMLInputElement).value);
    }

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void this.state.loadFile(file);
        input.value = ''; // allow re-selecting the same file
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        this.state.isDragOver.set(true);
    }

    onDragLeave(): void {
        this.state.isDragOver.set(false);
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        this.state.isDragOver.set(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) void this.state.loadFile(file);
    }
}
