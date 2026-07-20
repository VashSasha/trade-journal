import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountService } from '../../account.service';

/** Danger zone: sign out everywhere, and delete account (typed confirmation). */
@Component({
    selector: 'app-account-danger',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './account-danger.component.html',
    styleUrl: './account-danger.component.scss'
})
export class AccountDangerComponent {
    private account = inject(AccountService);
    private router = inject(Router);

    signingOut = signal(false);

    showDelete = signal(false);
    confirmText = signal('');
    deleting = signal(false);
    deleteError = signal<string | null>(null);

    /** Require the user to type DELETE to arm the button. */
    readonly canDelete = computed(() => this.confirmText().trim().toUpperCase() === 'DELETE');

    async signOutEverywhere(): Promise<void> {
        this.signingOut.set(true);
        // Global sign-out fires SIGNED_OUT, clearing session state.
        await this.account.signOutEverywhere();
        this.router.navigate(['/login']);
    }

    async deleteAccount(): Promise<void> {
        if (!this.canDelete() || this.deleting()) return;
        this.deleting.set(true);
        this.deleteError.set(null);

        const { error } = await this.account.deleteAccount();
        if (error) {
            this.deleteError.set(error);
            this.deleting.set(false);
            return;
        }
        // Account and its data are gone — clear the local session and leave.
        await this.account.signOutEverywhere().catch(() => { /* already deleted */ });
        this.router.navigate(['/login']);
    }
}
